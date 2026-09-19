#include "matching_engine/matching_engine.hpp"

#include <algorithm>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>

namespace paper::matching {
namespace {

CommandResult accepted_result(const std::string& command_id, const Sequence book_sequence) {
    return CommandResult{
        .command_id = command_id,
        .accepted = true,
        .rejection = std::nullopt,
        .order = std::nullopt,
        .fills = {},
        .resting_order_updates = {},
        .snapshot = std::nullopt,
        .book_sequence = book_sequence,
    };
}

}  // namespace

MatchingEngine::MatchingEngine(Logger logger) : logger_(std::move(logger)) {}

Sequence MatchingEngine::next_sequence() {
    if (current_sequence_ == std::numeric_limits<Sequence>::max()) {
        throw std::overflow_error("engine sequence exhausted signed 64-bit range");
    }
    ++current_sequence_;
    return current_sequence_;
}

const CommandResult* MatchingEngine::cached_result(const std::string& command_id) const {
    const auto found = command_results_.find(command_id);
    return found == command_results_.end() ? nullptr : &found->second;
}

void MatchingEngine::remember_result(const CommandResult& result) {
    if (!result.command_id.empty()) {
        command_results_.emplace(result.command_id, result);
    }
}

void MatchingEngine::log(const std::string_view message) const {
    if (logger_) {
        logger_(message);
    }
}

CommandResult MatchingEngine::reject(
    const std::string& command_id,
    std::string code,
    std::string message) {
    CommandResult result{
        .command_id = command_id,
        .accepted = false,
        .rejection = Rejection{.code = std::move(code), .message = std::move(message)},
        .order = std::nullopt,
        .fills = {},
        .resting_order_updates = {},
        .snapshot = std::nullopt,
        .book_sequence = current_sequence_,
    };
    remember_result(result);
    log(result.rejection->code);
    return result;
}

std::optional<Rejection> MatchingEngine::validate_order(const OrderRequest& order) const {
    if (order.order_id.empty() || order.participant_id.empty() || order.instrument_key.empty()) {
        return Rejection{
            .code = "INVALID_ORDER",
            .message = "Order, participant, and instrument identifiers are required",
        };
    }
    if (order.quantity <= 0) {
        return Rejection{
            .code = "INVALID_QUANTITY",
            .message = "Quantity must be positive",
        };
    }
    if (order.order_type == OrderType::Limit) {
        if (!order.limit_price_paise.has_value() || order.limit_price_paise.value() <= 0) {
            return Rejection{
                .code = "INVALID_LIMIT_PRICE",
                .message = "LIMIT orders require a positive limit price",
            };
        }
    } else if (order.limit_price_paise.has_value()) {
        return Rejection{
            .code = "MARKET_PRICE_FORBIDDEN",
            .message = "MARKET orders must not include a limit price",
        };
    }
    return std::nullopt;
}

CommandResult MatchingEngine::add_order(
    const std::string& command_id,
    const OrderRequest& order) {
    if (const auto* cached = cached_result(command_id); cached != nullptr) {
        return *cached;
    }
    if (command_id.empty()) {
        return reject(command_id, "INVALID_COMMAND_ID", "Command identifier is required");
    }
    if (const auto rejection = validate_order(order); rejection.has_value()) {
        return reject(command_id, rejection->code, rejection->message);
    }
    if (known_order_ids_.contains(order.order_id)) {
        return reject(command_id, "DUPLICATE_ORDER_ID", "Order identifier has already been used");
    }

    const Sequence order_sequence = next_sequence();
    known_order_ids_.insert(order.order_id);
    known_order_sequences_.insert(order_sequence);
    auto [book, inserted] = books_.try_emplace(order.instrument_key, order.instrument_key);
    static_cast<void>(inserted);
    auto outcome = book->second.add(order, order_sequence, [this]() { return next_sequence(); });

    for (const auto& update : outcome.resting_order_updates) {
        if (update.status == OrderStatus::Filled) {
            active_order_instruments_.erase(update.order_id);
            terminal_orders_.insert_or_assign(update.order_id, update);
        }
    }

    if (outcome.incoming_rests) {
        active_order_instruments_.emplace(order.order_id, order.instrument_key);
    } else {
        terminal_orders_.insert_or_assign(order.order_id, outcome.incoming_order);
    }

    CommandResult result = accepted_result(command_id, current_sequence_);
    result.order = std::move(outcome.incoming_order);
    result.fills = std::move(outcome.fills);
    result.resting_order_updates = std::move(outcome.resting_order_updates);
    remember_result(result);
    log("ADD_ORDER accepted");
    return result;
}

CommandResult MatchingEngine::cancel_order(
    const std::string& command_id,
    const std::string& order_id) {
    if (const auto* cached = cached_result(command_id); cached != nullptr) {
        return *cached;
    }
    if (command_id.empty()) {
        return reject(command_id, "INVALID_COMMAND_ID", "Command identifier is required");
    }
    if (order_id.empty()) {
        return reject(command_id, "INVALID_ORDER_ID", "Order identifier is required");
    }

    if (const auto terminal = terminal_orders_.find(order_id); terminal != terminal_orders_.end()) {
        auto result = accepted_result(command_id, current_sequence_);
        result.order = terminal->second;
        remember_result(result);
        return result;
    }

    const auto active = active_order_instruments_.find(order_id);
    if (active == active_order_instruments_.end()) {
        return reject(command_id, "ORDER_NOT_FOUND", "No order exists with that identifier");
    }
    const auto book = books_.find(active->second);
    if (book == books_.end()) {
        throw std::logic_error("active order points to a missing order book");
    }
    auto cancelled = book->second.cancel(order_id);
    if (!cancelled.has_value()) {
        throw std::logic_error("active order locator is inconsistent with its order book");
    }

    next_sequence();
    active_order_instruments_.erase(active);
    terminal_orders_.insert_or_assign(order_id, cancelled.value());
    auto result = accepted_result(command_id, current_sequence_);
    result.order = std::move(cancelled.value());
    remember_result(result);
    log("CANCEL_ORDER accepted");
    return result;
}

CommandResult MatchingEngine::replay_order(
    const std::string& command_id,
    const ReplayOrderRequest& replay) {
    if (const auto* cached = cached_result(command_id); cached != nullptr) {
        return *cached;
    }
    if (command_id.empty()) {
        return reject(command_id, "INVALID_COMMAND_ID", "Command identifier is required");
    }
    if (const auto rejection = validate_order(replay.order); rejection.has_value()) {
        return reject(command_id, rejection->code, rejection->message);
    }
    if (replay.order.order_type != OrderType::Limit) {
        return reject(command_id, "REPLAY_LIMIT_ONLY", "Only active LIMIT orders can be replayed");
    }
    if (replay.remaining_quantity <= 0 || replay.remaining_quantity > replay.order.quantity) {
        return reject(
            command_id,
            "INVALID_REMAINING_QUANTITY",
            "Replay remaining quantity must be positive and no greater than original quantity");
    }
    if (replay.engine_sequence <= 0) {
        return reject(command_id, "INVALID_ENGINE_SEQUENCE", "Replay sequence must be positive");
    }
    if (known_order_ids_.contains(replay.order.order_id)) {
        return reject(command_id, "DUPLICATE_ORDER_ID", "Order identifier has already been used");
    }
    if (known_order_sequences_.contains(replay.engine_sequence)) {
        return reject(
            command_id,
            "DUPLICATE_ENGINE_SEQUENCE",
            "Replay engine sequence has already been used by an order");
    }

    known_order_ids_.insert(replay.order.order_id);
    known_order_sequences_.insert(replay.engine_sequence);
    current_sequence_ = std::max(current_sequence_, replay.engine_sequence);
    auto [book, inserted] =
        books_.try_emplace(replay.order.instrument_key, replay.order.instrument_key);
    static_cast<void>(inserted);
    auto order_state = book->second.replay(replay);
    active_order_instruments_.emplace(replay.order.order_id, replay.order.instrument_key);

    auto result = accepted_result(command_id, current_sequence_);
    result.order = std::move(order_state);
    remember_result(result);
    log("REPLAY_ORDER accepted");
    return result;
}

CommandResult MatchingEngine::reset(
    const std::string& command_id,
    const Sequence sequence_floor) {
    if (const auto* cached = cached_result(command_id); cached != nullptr) {
        return *cached;
    }
    if (command_id.empty()) {
        return reject(command_id, "INVALID_COMMAND_ID", "Command identifier is required");
    }
    if (sequence_floor < 0) {
        return reject(
            command_id,
            "INVALID_ENGINE_SEQUENCE",
            "Reset sequence floor must not be negative");
    }

    books_.clear();
    active_order_instruments_.clear();
    terminal_orders_.clear();
    known_order_ids_.clear();
    known_order_sequences_.clear();
    current_sequence_ = sequence_floor;

    auto result = accepted_result(command_id, current_sequence_);
    remember_result(result);
    log("RESET accepted");
    return result;
}

CommandResult MatchingEngine::snapshot_book(
    const std::string& command_id,
    const std::string& instrument_key) {
    if (const auto* cached = cached_result(command_id); cached != nullptr) {
        return *cached;
    }
    if (command_id.empty()) {
        return reject(command_id, "INVALID_COMMAND_ID", "Command identifier is required");
    }
    if (instrument_key.empty()) {
        return reject(command_id, "INVALID_INSTRUMENT", "Instrument identifier is required");
    }

    auto [book, inserted] = books_.try_emplace(instrument_key, instrument_key);
    static_cast<void>(inserted);
    auto result = accepted_result(command_id, current_sequence_);
    result.snapshot = book->second.snapshot(current_sequence_);
    remember_result(result);
    return result;
}

Sequence MatchingEngine::current_sequence() const noexcept {
    return current_sequence_;
}

}  // namespace paper::matching
