#include "matching_engine/order_book.hpp"

#include <algorithm>
#include <deque>
#include <limits>
#include <map>
#include <memory>
#include <stdexcept>
#include <unordered_map>
#include <utility>

namespace paper::matching {
namespace {

struct RestingOrder {
    OrderRequest request;
    Quantity remaining_quantity{0};
    Sequence engine_sequence{0};
    bool active{true};
};

using OrderPointer = std::shared_ptr<RestingOrder>;
using BidLevels = std::map<Price, std::deque<OrderPointer>, std::greater<Price>>;
using AskLevels = std::map<Price, std::deque<OrderPointer>>;

OrderState state_for(const RestingOrder& order, const OrderStatus status) {
    return OrderState{
        .order_id = order.request.order_id,
        .status = status,
        .filled_quantity = order.request.quantity - order.remaining_quantity,
        .remaining_quantity = order.remaining_quantity,
        .engine_sequence = order.engine_sequence,
    };
}

template <typename Levels>
OrderPointer first_active_order(Levels& levels) {
    while (!levels.empty()) {
        auto level = levels.begin();
        auto& queue = level->second;
        while (!queue.empty() && (!queue.front()->active || queue.front()->remaining_quantity == 0)) {
            queue.pop_front();
        }
        if (queue.empty()) {
            levels.erase(level);
            continue;
        }
        return queue.front();
    }
    return {};
}

template <typename Levels>
std::vector<PriceLevel> snapshot_levels(const Levels& levels) {
    std::vector<PriceLevel> result;
    result.reserve(levels.size());

    for (const auto& [price, queue] : levels) {
        PriceLevel level{
            .price_paise = price,
            .total_quantity = 0,
            .orders = {},
        };
        for (const auto& order : queue) {
            if (!order->active || order->remaining_quantity == 0) {
                continue;
            }
            if (level.total_quantity >
                std::numeric_limits<Quantity>::max() - order->remaining_quantity) {
                throw std::overflow_error("snapshot quantity exceeds signed 64-bit range");
            }
            level.total_quantity += order->remaining_quantity;
            level.orders.push_back(SnapshotOrder{
                .order_id = order->request.order_id,
                .participant_id = order->request.participant_id,
                .remaining_quantity = order->remaining_quantity,
                .engine_sequence = order->engine_sequence,
            });
        }
        if (!level.orders.empty()) {
            result.push_back(std::move(level));
        }
    }

    return result;
}

}  // namespace

struct OrderBook::Impl {
    explicit Impl(std::string key) : instrument_key(std::move(key)) {}

    void rest(const OrderPointer& order) {
        const Price price = order->request.limit_price_paise.value();
        if (order->request.side == Side::Buy) {
            bids[price].push_back(order);
        } else {
            asks[price].push_back(order);
        }
        active_orders.emplace(order->request.order_id, order);
    }

    [[nodiscard]] OrderPointer best_opposite(const Side incoming_side) {
        return incoming_side == Side::Buy ? first_active_order(asks) : first_active_order(bids);
    }

    [[nodiscard]] bool crosses(const OrderRequest& incoming, const Price maker_price) const {
        if (incoming.order_type == OrderType::Market) {
            return true;
        }
        const Price limit = incoming.limit_price_paise.value();
        return incoming.side == Side::Buy ? maker_price <= limit : maker_price >= limit;
    }

    std::string instrument_key;
    BidLevels bids;
    AskLevels asks;
    std::unordered_map<std::string, OrderPointer> active_orders;
};

OrderBook::OrderBook(std::string instrument_key)
    : implementation_(std::make_unique<Impl>(std::move(instrument_key))) {}

OrderBook::~OrderBook() = default;
OrderBook::OrderBook(OrderBook&&) noexcept = default;
OrderBook& OrderBook::operator=(OrderBook&&) noexcept = default;

AddOutcome OrderBook::add(
    const OrderRequest& request,
    const Sequence order_sequence,
    const std::function<Sequence()>& next_sequence) {
    Quantity remaining = request.quantity;
    bool self_trade_prevented = false;
    AddOutcome outcome;

    while (remaining > 0) {
        const auto maker = implementation_->best_opposite(request.side);
        if (!maker || !implementation_->crosses(request, maker->request.limit_price_paise.value())) {
            break;
        }
        if (maker->request.participant_id == request.participant_id) {
            self_trade_prevented = true;
            break;
        }

        const Quantity fill_quantity = std::min(remaining, maker->remaining_quantity);
        remaining -= fill_quantity;
        maker->remaining_quantity -= fill_quantity;
        const Sequence trade_sequence = next_sequence();
        const bool incoming_is_buy = request.side == Side::Buy;
        outcome.fills.push_back(Fill{
            .trade_id = "engine-trade-" + std::to_string(trade_sequence),
            .instrument_key = request.instrument_key,
            .maker_order_id = maker->request.order_id,
            .taker_order_id = request.order_id,
            .buy_order_id = incoming_is_buy ? request.order_id : maker->request.order_id,
            .sell_order_id = incoming_is_buy ? maker->request.order_id : request.order_id,
            .quantity = fill_quantity,
            .price_paise = maker->request.limit_price_paise.value(),
            .engine_sequence = trade_sequence,
        });

        const OrderStatus maker_status = maker->remaining_quantity == 0
                                             ? OrderStatus::Filled
                                             : OrderStatus::PartiallyFilled;
        outcome.resting_order_updates.push_back(state_for(*maker, maker_status));
        if (maker->remaining_quantity == 0) {
            maker->active = false;
            implementation_->active_orders.erase(maker->request.order_id);
            outcome.terminal_order_ids.push_back(maker->request.order_id);
        }
    }

    OrderStatus incoming_status = OrderStatus::Filled;
    if (remaining > 0) {
        if (request.order_type == OrderType::Limit && !self_trade_prevented) {
            incoming_status = remaining == request.quantity ? OrderStatus::Open
                                                            : OrderStatus::PartiallyFilled;
            auto resting = std::make_shared<RestingOrder>(RestingOrder{
                .request = request,
                .remaining_quantity = remaining,
                .engine_sequence = order_sequence,
            });
            implementation_->rest(resting);
            outcome.incoming_rests = true;
        } else {
            incoming_status = OrderStatus::Cancelled;
        }
    }

    outcome.incoming_order = OrderState{
        .order_id = request.order_id,
        .status = incoming_status,
        .filled_quantity = request.quantity - remaining,
        .remaining_quantity = remaining,
        .engine_sequence = order_sequence,
    };
    return outcome;
}

std::optional<OrderState> OrderBook::cancel(const std::string& order_id) {
    const auto found = implementation_->active_orders.find(order_id);
    if (found == implementation_->active_orders.end()) {
        return std::nullopt;
    }

    const auto order = found->second;
    order->active = false;
    implementation_->active_orders.erase(found);
    return state_for(*order, OrderStatus::Cancelled);
}

OrderState OrderBook::replay(const ReplayOrderRequest& request) {
    auto resting = std::make_shared<RestingOrder>(RestingOrder{
        .request = request.order,
        .remaining_quantity = request.remaining_quantity,
        .engine_sequence = request.engine_sequence,
    });
    implementation_->rest(resting);

    const OrderStatus status = request.remaining_quantity == request.order.quantity
                                   ? OrderStatus::Open
                                   : OrderStatus::PartiallyFilled;
    return state_for(*resting, status);
}

BookSnapshot OrderBook::snapshot(const Sequence book_sequence) const {
    return BookSnapshot{
        .instrument_key = implementation_->instrument_key,
        .bids = snapshot_levels(implementation_->bids),
        .asks = snapshot_levels(implementation_->asks),
        .book_sequence = book_sequence,
    };
}

}  // namespace paper::matching
