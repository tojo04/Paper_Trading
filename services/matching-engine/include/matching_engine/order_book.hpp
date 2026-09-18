#pragma once

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "matching_engine/types.hpp"

namespace paper::matching {

struct AddOutcome {
    OrderState incoming_order;
    std::vector<Fill> fills;
    std::vector<OrderState> resting_order_updates;
    std::vector<std::string> terminal_order_ids;
    bool incoming_rests{false};
};

class OrderBook {
  public:
    explicit OrderBook(std::string instrument_key);
    ~OrderBook();

    OrderBook(OrderBook&&) noexcept;
    OrderBook& operator=(OrderBook&&) noexcept;
    OrderBook(const OrderBook&) = delete;
    OrderBook& operator=(const OrderBook&) = delete;

    AddOutcome add(
        const OrderRequest& request,
        Sequence order_sequence,
        const std::function<Sequence()>& next_sequence);
    std::optional<OrderState> cancel(const std::string& order_id);
    OrderState replay(const ReplayOrderRequest& request);
    [[nodiscard]] BookSnapshot snapshot(Sequence book_sequence) const;

  private:
    struct Impl;
    std::unique_ptr<Impl> implementation_;
};

}  // namespace paper::matching
