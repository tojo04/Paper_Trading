#include <algorithm>
#include <cstdint>
#include <map>
#include <random>
#include <string>
#include <unordered_map>
#include <vector>

#include <gtest/gtest.h>

#include "matching_engine/matching_engine.hpp"

namespace paper::matching {
namespace {

constexpr const char* instrument = "NSE_EQ|INE002A01018";

OrderRequest limit_order(
    std::string order_id,
    std::string participant_id,
    const Side side,
    const Quantity quantity,
    const Price price) {
    return OrderRequest{
        .order_id = std::move(order_id),
        .participant_id = std::move(participant_id),
        .instrument_key = instrument,
        .side = side,
        .order_type = OrderType::Limit,
        .quantity = quantity,
        .limit_price_paise = price,
    };
}

OrderRequest market_order(
    std::string order_id,
    std::string participant_id,
    const Side side,
    const Quantity quantity) {
    return OrderRequest{
        .order_id = std::move(order_id),
        .participant_id = std::move(participant_id),
        .instrument_key = instrument,
        .side = side,
        .order_type = OrderType::Market,
        .quantity = quantity,
    };
}

TEST(MatchingEngineTest, MultiLevelLimitFillUsesEachRestingMakerPrice) {
    MatchingEngine engine;
    engine.add_order("cmd-1", limit_order("ask-1", "seller-1", Side::Sell, 10, 10'100));
    engine.add_order("cmd-2", limit_order("ask-2", "seller-2", Side::Sell, 15, 10'200));

    const auto result =
        engine.add_order("cmd-3", limit_order("buy-1", "buyer", Side::Buy, 20, 10'200));

    ASSERT_TRUE(result.accepted);
    ASSERT_EQ(result.fills.size(), 2U);
    EXPECT_EQ(result.fills[0].quantity, 10);
    EXPECT_EQ(result.fills[0].price_paise, 10'100);
    EXPECT_EQ(result.fills[1].quantity, 10);
    EXPECT_EQ(result.fills[1].price_paise, 10'200);
    ASSERT_TRUE(result.order.has_value());
    EXPECT_EQ(result.order->status, OrderStatus::Filled);
    EXPECT_EQ(result.order->remaining_quantity, 0);

    const auto snapshot = engine.snapshot_book("snapshot-1", instrument);
    ASSERT_TRUE(snapshot.snapshot.has_value());
    ASSERT_EQ(snapshot.snapshot->asks.size(), 1U);
    EXPECT_EQ(snapshot.snapshot->asks[0].price_paise, 10'200);
    EXPECT_EQ(snapshot.snapshot->asks[0].total_quantity, 5);
}

TEST(MatchingEngineTest, SamePriceOrdersFillInEngineSequenceOrder) {
    MatchingEngine engine;
    engine.add_order("cmd-1", limit_order("ask-first", "seller-1", Side::Sell, 5, 10'100));
    engine.add_order("cmd-2", limit_order("ask-second", "seller-2", Side::Sell, 5, 10'100));

    const auto result = engine.add_order("cmd-3", market_order("buy", "buyer", Side::Buy, 6));

    ASSERT_EQ(result.fills.size(), 2U);
    EXPECT_EQ(result.fills[0].maker_order_id, "ask-first");
    EXPECT_EQ(result.fills[0].quantity, 5);
    EXPECT_EQ(result.fills[1].maker_order_id, "ask-second");
    EXPECT_EQ(result.fills[1].quantity, 1);
    EXPECT_LT(result.fills[0].engine_sequence, result.fills[1].engine_sequence);
}

TEST(MatchingEngineTest, NonCrossingLimitOrderRestsInTheBook) {
    MatchingEngine engine;
    engine.add_order("cmd-1", limit_order("ask", "seller", Side::Sell, 10, 10'100));

    const auto result =
        engine.add_order("cmd-2", limit_order("bid", "buyer", Side::Buy, 7, 10'000));
    const auto snapshot = engine.snapshot_book("snapshot", instrument);

    ASSERT_TRUE(result.order.has_value());
    EXPECT_EQ(result.order->status, OrderStatus::Open);
    ASSERT_TRUE(snapshot.snapshot.has_value());
    ASSERT_EQ(snapshot.snapshot->bids.size(), 1U);
    EXPECT_EQ(snapshot.snapshot->bids[0].price_paise, 10'000);
    EXPECT_EQ(snapshot.snapshot->bids[0].orders[0].order_id, "bid");
}

TEST(MatchingEngineTest, MarketRemainderIsCancelledAndNeverRests) {
    MatchingEngine engine;
    engine.add_order("cmd-1", limit_order("ask", "seller", Side::Sell, 3, 10'100));

    const auto result = engine.add_order("cmd-2", market_order("buy", "buyer", Side::Buy, 5));
    const auto snapshot = engine.snapshot_book("snapshot", instrument);

    ASSERT_TRUE(result.order.has_value());
    EXPECT_EQ(result.order->status, OrderStatus::Cancelled);
    EXPECT_EQ(result.order->filled_quantity, 3);
    EXPECT_EQ(result.order->remaining_quantity, 2);
    ASSERT_TRUE(snapshot.snapshot.has_value());
    EXPECT_TRUE(snapshot.snapshot->bids.empty());
    EXPECT_TRUE(snapshot.snapshot->asks.empty());
}

TEST(MatchingEngineTest, RepeatedCancellationReleasesNoBookQuantityTwice) {
    MatchingEngine engine;
    engine.add_order("cmd-1", limit_order("bid", "buyer", Side::Buy, 8, 10'000));

    const auto first = engine.cancel_order("cancel-1", "bid");
    const Sequence sequence_after_first = engine.current_sequence();
    const auto repeated = engine.cancel_order("cancel-2", "bid");
    const auto snapshot = engine.snapshot_book("snapshot", instrument);

    EXPECT_TRUE(first.accepted);
    EXPECT_TRUE(repeated.accepted);
    EXPECT_EQ(first.order, repeated.order);
    EXPECT_EQ(engine.current_sequence(), sequence_after_first);
    ASSERT_TRUE(snapshot.snapshot.has_value());
    EXPECT_TRUE(snapshot.snapshot->bids.empty());
}

TEST(MatchingEngineTest, SelfTradePreventionCancelsTheIncomingRemainder) {
    MatchingEngine engine;
    engine.add_order("cmd-1", limit_order("ask", "same-user", Side::Sell, 5, 10'100));

    const auto result =
        engine.add_order("cmd-2", limit_order("buy", "same-user", Side::Buy, 5, 10'100));
    const auto snapshot = engine.snapshot_book("snapshot", instrument);

    ASSERT_TRUE(result.order.has_value());
    EXPECT_EQ(result.order->status, OrderStatus::Cancelled);
    EXPECT_EQ(result.order->filled_quantity, 0);
    EXPECT_TRUE(result.fills.empty());
    ASSERT_TRUE(snapshot.snapshot.has_value());
    ASSERT_EQ(snapshot.snapshot->asks.size(), 1U);
    EXPECT_EQ(snapshot.snapshot->asks[0].total_quantity, 5);
    EXPECT_TRUE(snapshot.snapshot->bids.empty());
}

TEST(MatchingEngineTest, DuplicateCommandReturnsOriginalResultWithoutApplyingAgain) {
    MatchingEngine engine;
    const auto first =
        engine.add_order("duplicate-command", limit_order("bid-1", "buyer", Side::Buy, 4, 10'000));
    const auto duplicate = engine.add_order(
        "duplicate-command",
        limit_order("bid-2", "other-buyer", Side::Buy, 99, 20'000));
    const auto snapshot = engine.snapshot_book("snapshot", instrument);

    EXPECT_EQ(first, duplicate);
    ASSERT_TRUE(snapshot.snapshot.has_value());
    ASSERT_EQ(snapshot.snapshot->bids.size(), 1U);
    ASSERT_EQ(snapshot.snapshot->bids[0].orders.size(), 1U);
    EXPECT_EQ(snapshot.snapshot->bids[0].orders[0].order_id, "bid-1");
}

TEST(MatchingEngineTest, IntegerPricesAboveJavaScriptSafeRangeRemainExact) {
    constexpr Price exact_price = 9'007'199'254'740'993LL;
    MatchingEngine engine;
    engine.add_order("cmd-1", limit_order("ask", "seller", Side::Sell, 1, exact_price));

    const auto result = engine.add_order("cmd-2", market_order("buy", "buyer", Side::Buy, 1));

    ASSERT_EQ(result.fills.size(), 1U);
    EXPECT_EQ(result.fills[0].price_paise, exact_price);
}

TEST(MatchingEngineTest, ResetAndReplayReconstructTheSameVisibleBookWithoutTrades) {
    MatchingEngine engine;
    const auto bid =
        engine.add_order("cmd-1", limit_order("bid", "buyer", Side::Buy, 8, 10'000));
    const auto ask =
        engine.add_order("cmd-2", limit_order("ask", "seller", Side::Sell, 6, 10'200));
    const auto before = engine.snapshot_book("before", instrument).snapshot.value();
    const Sequence durable_high_water_mark = engine.current_sequence();

    engine.reset("reset", durable_high_water_mark);
    const auto replayed_bid = engine.replay_order(
        "replay-1",
        ReplayOrderRequest{
            .order = limit_order("bid", "buyer", Side::Buy, 8, 10'000),
            .remaining_quantity = 8,
            .engine_sequence = bid.order->engine_sequence,
        });
    const auto replayed_ask = engine.replay_order(
        "replay-2",
        ReplayOrderRequest{
            .order = limit_order("ask", "seller", Side::Sell, 6, 10'200),
            .remaining_quantity = 6,
            .engine_sequence = ask.order->engine_sequence,
        });
    const auto after = engine.snapshot_book("after", instrument).snapshot.value();

    EXPECT_TRUE(replayed_bid.fills.empty());
    EXPECT_TRUE(replayed_ask.fills.empty());
    EXPECT_EQ(before.bids, after.bids);
    EXPECT_EQ(before.asks, after.asks);
    EXPECT_EQ(engine.current_sequence(), durable_high_water_mark);
}

TEST(MatchingEngineTest, RandomizedCommandsConserveQuantityAcrossEveryFill) {
    MatchingEngine engine;
    std::mt19937 generator(42U);
    std::uniform_int_distribution<int> side_distribution(0, 1);
    std::uniform_int_distribution<int> type_distribution(0, 3);
    std::uniform_int_distribution<int> quantity_distribution(1, 30);
    std::uniform_int_distribution<int> price_distribution(9'900, 10'100);
    std::unordered_map<std::string, Quantity> active_remaining;
    std::vector<std::string> active_ids;

    for (int index = 0; index < 750; ++index) {
        if (index % 11 == 0 && !active_ids.empty()) {
            const std::string order_id = active_ids.back();
            active_ids.pop_back();
            const auto cancellation =
                engine.cancel_order("random-cancel-" + std::to_string(index), order_id);
            ASSERT_TRUE(cancellation.accepted);
            active_remaining.erase(order_id);
            continue;
        }

        const Side side = side_distribution(generator) == 0 ? Side::Buy : Side::Sell;
        const Quantity quantity = quantity_distribution(generator);
        const bool is_market = type_distribution(generator) == 0;
        const std::string order_id = "random-order-" + std::to_string(index);
        const OrderRequest order =
            is_market
                ? market_order(order_id, "participant-" + std::to_string(index), side, quantity)
                : limit_order(
                      order_id,
                      "participant-" + std::to_string(index),
                      side,
                      quantity,
                      price_distribution(generator));
        const auto result = engine.add_order("random-command-" + std::to_string(index), order);
        ASSERT_TRUE(result.accepted);
        ASSERT_TRUE(result.order.has_value());

        Quantity fill_total = 0;
        for (const auto& fill : result.fills) {
            EXPECT_GT(fill.quantity, 0);
            EXPECT_NE(fill.buy_order_id, fill.sell_order_id);
            fill_total += fill.quantity;
        }
        EXPECT_EQ(result.order->filled_quantity, fill_total);

        Quantity maker_reduction_total = 0;
        for (const auto& update : result.resting_order_updates) {
            const auto previous = active_remaining.find(update.order_id);
            ASSERT_NE(previous, active_remaining.end());
            maker_reduction_total += previous->second - update.remaining_quantity;
            if (update.status == OrderStatus::Filled) {
                active_remaining.erase(previous);
                active_ids.erase(
                    std::remove(active_ids.begin(), active_ids.end(), update.order_id),
                    active_ids.end());
            } else {
                previous->second = update.remaining_quantity;
            }
        }
        EXPECT_EQ(maker_reduction_total, fill_total);

        if (result.order->status == OrderStatus::Open ||
            result.order->status == OrderStatus::PartiallyFilled) {
            active_remaining.emplace(order_id, result.order->remaining_quantity);
            active_ids.push_back(order_id);
        }
    }
}

}  // namespace
}  // namespace paper::matching

