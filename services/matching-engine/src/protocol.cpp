#include "matching_engine/protocol.hpp"

#include <charconv>
#include <exception>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>

#include <nlohmann/json.hpp>

namespace paper::matching {
namespace {

using Json = nlohmann::json;

class ProtocolError final : public std::runtime_error {
  public:
    ProtocolError(std::string code, std::string message)
        : std::runtime_error(std::move(message)), code_(std::move(code)) {}

    [[nodiscard]] const std::string& code() const noexcept { return code_; }

  private:
    std::string code_;
};

std::string status_name(const OrderStatus status) {
    switch (status) {
        case OrderStatus::Open:
            return "OPEN";
        case OrderStatus::PartiallyFilled:
            return "PARTIALLY_FILLED";
        case OrderStatus::Filled:
            return "FILLED";
        case OrderStatus::Cancelled:
            return "CANCELLED";
        case OrderStatus::Rejected:
            return "REJECTED";
    }
    throw std::logic_error("unknown order status");
}

Side parse_side(const std::string& value) {
    if (value == "BUY") {
        return Side::Buy;
    }
    if (value == "SELL") {
        return Side::Sell;
    }
    throw ProtocolError("INVALID_SIDE", "side must be BUY or SELL");
}

OrderType parse_order_type(const std::string& value) {
    if (value == "LIMIT") {
        return OrderType::Limit;
    }
    if (value == "MARKET") {
        return OrderType::Market;
    }
    throw ProtocolError("INVALID_ORDER_TYPE", "orderType must be LIMIT or MARKET");
}

std::int64_t parse_integer_string(const Json& value, const std::string_view field_name) {
    if (!value.is_string()) {
        throw ProtocolError(
            "INVALID_INTEGER_ENCODING",
            std::string(field_name) + " must be a decimal string");
    }
    const std::string text = value.get<std::string>();
    std::int64_t parsed = 0;
    const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), parsed);
    if (error != std::errc{} || end != text.data() + text.size()) {
        throw ProtocolError(
            "INVALID_INTEGER_ENCODING",
            std::string(field_name) + " must fit a signed 64-bit integer");
    }
    return parsed;
}

bool looks_like_uuid(const std::string& value) {
    if (value.size() != 36U) {
        return false;
    }
    for (std::size_t index = 0; index < value.size(); ++index) {
        const char character = value[index];
        if (index == 8U || index == 13U || index == 18U || index == 23U) {
            if (character != '-') {
                return false;
            }
            continue;
        }
        const bool decimal = character >= '0' && character <= '9';
        const bool lower_hex = character >= 'a' && character <= 'f';
        const bool upper_hex = character >= 'A' && character <= 'F';
        if (!decimal && !lower_hex && !upper_hex) {
            return false;
        }
    }
    return true;
}

std::string required_string(const Json& object, const std::string& field_name) {
    const auto& value = object.at(field_name);
    if (!value.is_string()) {
        throw ProtocolError("INVALID_COMMAND", field_name + " must be a string");
    }
    return value.get<std::string>();
}

OrderRequest parse_order(const Json& payload) {
    OrderRequest order{
        .order_id = required_string(payload, "orderId"),
        .participant_id = required_string(payload, "participantId"),
        .instrument_key = required_string(payload, "instrumentKey"),
        .side = parse_side(required_string(payload, "side")),
        .order_type = parse_order_type(required_string(payload, "orderType")),
        .quantity = parse_integer_string(payload.at("quantity"), "quantity"),
        .limit_price_paise = std::nullopt,
    };
    if (!looks_like_uuid(order.order_id)) {
        throw ProtocolError("INVALID_ORDER_ID", "orderId must be a UUID");
    }
    if (payload.contains("limitPricePaise") && !payload.at("limitPricePaise").is_null()) {
        order.limit_price_paise =
            parse_integer_string(payload.at("limitPricePaise"), "limitPricePaise");
    }
    return order;
}

Json order_state_json(const OrderState& order) {
    return Json{
        {"orderId", order.order_id},
        {"status", status_name(order.status)},
        {"filledQuantity", std::to_string(order.filled_quantity)},
        {"remainingQuantity", std::to_string(order.remaining_quantity)},
        {"engineSequence", std::to_string(order.engine_sequence)},
    };
}

Json fill_json(const Fill& fill) {
    return Json{
        {"tradeId", fill.trade_id},
        {"instrumentKey", fill.instrument_key},
        {"makerOrderId", fill.maker_order_id},
        {"takerOrderId", fill.taker_order_id},
        {"buyOrderId", fill.buy_order_id},
        {"sellOrderId", fill.sell_order_id},
        {"quantity", std::to_string(fill.quantity)},
        {"pricePaise", std::to_string(fill.price_paise)},
        {"engineSequence", std::to_string(fill.engine_sequence)},
    };
}

Json price_level_json(const PriceLevel& level) {
    Json orders = Json::array();
    for (const auto& order : level.orders) {
        orders.push_back(Json{
            {"orderId", order.order_id},
            {"participantId", order.participant_id},
            {"remainingQuantity", std::to_string(order.remaining_quantity)},
            {"engineSequence", std::to_string(order.engine_sequence)},
        });
    }
    return Json{
        {"pricePaise", std::to_string(level.price_paise)},
        {"totalQuantity", std::to_string(level.total_quantity)},
        {"orders", std::move(orders)},
    };
}

Json snapshot_json(const BookSnapshot& snapshot) {
    Json bids = Json::array();
    Json asks = Json::array();
    for (const auto& level : snapshot.bids) {
        bids.push_back(price_level_json(level));
    }
    for (const auto& level : snapshot.asks) {
        asks.push_back(price_level_json(level));
    }
    return Json{
        {"instrumentKey", snapshot.instrument_key},
        {"bids", std::move(bids)},
        {"asks", std::move(asks)},
        {"bookSequence", std::to_string(snapshot.book_sequence)},
    };
}

Json rejection_response(
    const std::string& command_id,
    const std::string& type,
    const std::string& code,
    const std::string& message) {
    return Json{
        {"protocolVersion", 1},
        {"commandId", command_id},
        {"type", type},
        {"accepted", false},
        {"rejection", Json{{"code", code}, {"message", message}}},
    };
}

Json engine_response(const std::string& type, const CommandResult& result) {
    if (!result.accepted) {
        return rejection_response(
            result.command_id,
            type,
            result.rejection->code,
            result.rejection->message);
    }

    Json response{
        {"protocolVersion", 1},
        {"commandId", result.command_id},
        {"type", type},
        {"accepted", true},
    };
    Json body{{"bookSequence", std::to_string(result.book_sequence)}};
    if (result.order.has_value()) {
        body["order"] = order_state_json(result.order.value());
    }
    if (!result.fills.empty()) {
        body["fills"] = Json::array();
        for (const auto& fill : result.fills) {
            body["fills"].push_back(fill_json(fill));
        }
    } else if (type == "ADD_ORDER") {
        body["fills"] = Json::array();
    }
    if (!result.resting_order_updates.empty()) {
        body["restingOrderUpdates"] = Json::array();
        for (const auto& order : result.resting_order_updates) {
            body["restingOrderUpdates"].push_back(order_state_json(order));
        }
    } else if (type == "ADD_ORDER") {
        body["restingOrderUpdates"] = Json::array();
    }
    if (result.snapshot.has_value()) {
        body["snapshot"] = snapshot_json(result.snapshot.value());
    }
    response["result"] = std::move(body);
    return response;
}

}  // namespace

ProtocolProcessor::ProtocolProcessor(Logger logger)
    : logger_(std::move(logger)), engine_(logger_) {}

std::string ProtocolProcessor::process_line(const std::string& line) {
    std::string command_id;
    std::string type = "UNKNOWN";
    if (line.size() > max_protocol_line_bytes) {
        return rejection_response(
                   command_id,
                   type,
                   "MESSAGE_TOO_LARGE",
                   "Protocol line exceeds the configured byte limit")
            .dump();
    }

    try {
        const Json envelope = Json::parse(line);
        if (!envelope.is_object()) {
            throw ProtocolError("INVALID_COMMAND", "Command envelope must be an object");
        }
        if (envelope.contains("commandId") && envelope.at("commandId").is_string()) {
            command_id = envelope.at("commandId").get<std::string>();
        }
        if (envelope.contains("type") && envelope.at("type").is_string()) {
            type = envelope.at("type").get<std::string>();
        }
        if (envelope.at("protocolVersion") != 1) {
            throw ProtocolError(
                "UNSUPPORTED_PROTOCOL_VERSION",
                "Only matcher protocol version 1 is supported");
        }
        if (!looks_like_uuid(command_id)) {
            throw ProtocolError("INVALID_COMMAND_ID", "commandId must be a UUID");
        }
        const auto& payload = envelope.at("payload");
        if (!payload.is_object()) {
            throw ProtocolError("INVALID_COMMAND", "payload must be an object");
        }

        if (type == "PING") {
            return Json{
                {"protocolVersion", 1},
                {"commandId", command_id},
                {"type", type},
                {"accepted", true},
                {"result", Json{{"ready", true}}},
            }
                .dump();
        }
        if (type == "ADD_ORDER") {
            return engine_response(type, engine_.add_order(command_id, parse_order(payload))).dump();
        }
        if (type == "CANCEL_ORDER") {
            const std::string order_id = required_string(payload, "orderId");
            if (!looks_like_uuid(order_id)) {
                throw ProtocolError("INVALID_ORDER_ID", "orderId must be a UUID");
            }
            return engine_response(type, engine_.cancel_order(command_id, order_id)).dump();
        }
        if (type == "RESET") {
            Sequence floor = 0;
            if (payload.contains("sequenceFloor")) {
                floor = parse_integer_string(payload.at("sequenceFloor"), "sequenceFloor");
            }
            return engine_response(type, engine_.reset(command_id, floor)).dump();
        }
        if (type == "REPLAY_ORDER") {
            ReplayOrderRequest replay{
                .order = parse_order(payload),
                .remaining_quantity =
                    parse_integer_string(payload.at("remainingQuantity"), "remainingQuantity"),
                .engine_sequence =
                    parse_integer_string(payload.at("engineSequence"), "engineSequence"),
            };
            return engine_response(type, engine_.replay_order(command_id, replay)).dump();
        }
        if (type == "SNAPSHOT_BOOK") {
            return engine_response(
                       type,
                       engine_.snapshot_book(
                           command_id,
                           required_string(payload, "instrumentKey")))
                .dump();
        }
        throw ProtocolError("UNSUPPORTED_COMMAND", "Command type is not supported");
    } catch (const nlohmann::json::parse_error&) {
        return rejection_response(
                   command_id,
                   type,
                   "MALFORMED_MESSAGE",
                   "Input is not valid JSON")
            .dump();
    } catch (const ProtocolError& error) {
        return rejection_response(command_id, type, error.code(), error.what()).dump();
    } catch (const nlohmann::json::exception&) {
        return rejection_response(
                   command_id,
                   type,
                   "INVALID_COMMAND",
                   "Command is missing a required field or contains an invalid value")
            .dump();
    } catch (const std::exception& error) {
        if (logger_) {
            logger_(error.what());
        }
        return rejection_response(
                   command_id,
                   type,
                   "INTERNAL_ERROR",
                   "Matching engine could not process the command")
            .dump();
    }
}

}  // namespace paper::matching
