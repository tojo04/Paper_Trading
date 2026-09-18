#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace paper::matching {

using Price = std::int64_t;
using Quantity = std::int64_t;
using Sequence = std::int64_t;

enum class Side { Buy, Sell };
enum class OrderType { Market, Limit };
enum class OrderStatus { Open, PartiallyFilled, Filled, Cancelled, Rejected };

struct OrderRequest {
    std::string order_id;
    std::string participant_id;
    std::string instrument_key;
    Side side{Side::Buy};
    OrderType order_type{OrderType::Limit};
    Quantity quantity{0};
    std::optional<Price> limit_price_paise;

    bool operator==(const OrderRequest&) const = default;
};

struct ReplayOrderRequest {
    OrderRequest order;
    Quantity remaining_quantity{0};
    Sequence engine_sequence{0};

    bool operator==(const ReplayOrderRequest&) const = default;
};

struct OrderState {
    std::string order_id;
    OrderStatus status{OrderStatus::Rejected};
    Quantity filled_quantity{0};
    Quantity remaining_quantity{0};
    Sequence engine_sequence{0};

    bool operator==(const OrderState&) const = default;
};

struct Fill {
    std::string trade_id;
    std::string instrument_key;
    std::string maker_order_id;
    std::string taker_order_id;
    std::string buy_order_id;
    std::string sell_order_id;
    Quantity quantity{0};
    Price price_paise{0};
    Sequence engine_sequence{0};

    bool operator==(const Fill&) const = default;
};

struct SnapshotOrder {
    std::string order_id;
    std::string participant_id;
    Quantity remaining_quantity{0};
    Sequence engine_sequence{0};

    bool operator==(const SnapshotOrder&) const = default;
};

struct PriceLevel {
    Price price_paise{0};
    Quantity total_quantity{0};
    std::vector<SnapshotOrder> orders;

    bool operator==(const PriceLevel&) const = default;
};

struct BookSnapshot {
    std::string instrument_key;
    std::vector<PriceLevel> bids;
    std::vector<PriceLevel> asks;
    Sequence book_sequence{0};

    bool operator==(const BookSnapshot&) const = default;
};

struct Rejection {
    std::string code;
    std::string message;

    bool operator==(const Rejection&) const = default;
};

struct CommandResult {
    std::string command_id;
    bool accepted{false};
    std::optional<Rejection> rejection;
    std::optional<OrderState> order;
    std::vector<Fill> fills;
    std::vector<OrderState> resting_order_updates;
    std::optional<BookSnapshot> snapshot;
    Sequence book_sequence{0};

    bool operator==(const CommandResult&) const = default;
};

}  // namespace paper::matching

