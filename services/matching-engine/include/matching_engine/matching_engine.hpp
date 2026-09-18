#pragma once

#include <functional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>

#include "matching_engine/order_book.hpp"
#include "matching_engine/types.hpp"

namespace paper::matching {

using Logger = std::function<void(std::string_view)>;

class MatchingEngine {
  public:
    explicit MatchingEngine(Logger logger = {});

    CommandResult add_order(const std::string& command_id, const OrderRequest& order);
    CommandResult cancel_order(const std::string& command_id, const std::string& order_id);
    CommandResult replay_order(const std::string& command_id, const ReplayOrderRequest& order);
    CommandResult reset(const std::string& command_id, Sequence sequence_floor = 0);
    CommandResult snapshot_book(
        const std::string& command_id,
        const std::string& instrument_key);

    [[nodiscard]] Sequence current_sequence() const noexcept;

  private:
    Sequence next_sequence();
    CommandResult reject(
        const std::string& command_id,
        std::string code,
        std::string message);
    void remember_result(const CommandResult& result);
    [[nodiscard]] const CommandResult* cached_result(const std::string& command_id) const;
    [[nodiscard]] std::optional<Rejection> validate_order(const OrderRequest& order) const;
    void log(std::string_view message) const;

    Logger logger_;
    Sequence current_sequence_{0};
    std::unordered_map<std::string, OrderBook> books_;
    std::unordered_map<std::string, std::string> active_order_instruments_;
    std::unordered_map<std::string, OrderState> terminal_orders_;
    std::unordered_set<std::string> known_order_ids_;
    std::unordered_set<Sequence> known_order_sequences_;
    std::unordered_map<std::string, CommandResult> command_results_;
};

}  // namespace paper::matching

