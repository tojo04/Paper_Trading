#include <fstream>
#include <string>
#include <vector>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include "matching_engine/protocol.hpp"

namespace paper::matching {
namespace {

using Json = nlohmann::json;

std::vector<std::string> fixture_lines() {
    const std::string path = std::string(MATCHER_FIXTURES_DIR) + "/commands.jsonl";
    std::ifstream fixture(path);
    if (!fixture) {
        throw std::runtime_error("could not open shared matcher fixture: " + path);
    }
    std::vector<std::string> lines;
    std::string line;
    while (std::getline(fixture, line)) {
        if (!line.empty()) {
            lines.push_back(line);
        }
    }
    return lines;
}

TEST(ProtocolTest, SharedFixturePreservesStateAndDuplicateCommandResult) {
    ProtocolProcessor processor;
    const auto commands = fixture_lines();
    ASSERT_EQ(commands.size(), 7U);
    std::vector<Json> responses;
    for (const auto& command : commands) {
        responses.push_back(Json::parse(processor.process_line(command)));
    }

    EXPECT_TRUE(responses[0].at("result").at("ready").get<bool>());
    EXPECT_EQ(responses[2].at("result").at("order").at("status"), "OPEN");
    EXPECT_EQ(responses[3].at("result").at("order").at("status"), "FILLED");
    EXPECT_EQ(responses[3].at("result").at("fills")[0].at("pricePaise"), "10100");
    EXPECT_EQ(
        responses[4]
            .at("result")
            .at("snapshot")
            .at("asks")[0]
            .at("totalQuantity"),
        "6");
    EXPECT_EQ(responses[3], responses[5]);
    EXPECT_EQ(
        responses[6]
            .at("result")
            .at("snapshot")
            .at("asks")[0]
            .at("totalQuantity"),
        "6");
}

TEST(ProtocolTest, MalformedLineDoesNotCorruptTheNextValidRequest) {
    ProtocolProcessor processor;
    const Json malformed = Json::parse(processor.process_line("{not-json"));
    const Json ping = Json::parse(processor.process_line(
        R"({"protocolVersion":1,"commandId":"00000000-0000-4000-8000-000000000010","type":"PING","payload":{}})"));

    EXPECT_FALSE(malformed.at("accepted").get<bool>());
    EXPECT_EQ(malformed.at("rejection").at("code"), "MALFORMED_MESSAGE");
    EXPECT_TRUE(ping.at("accepted").get<bool>());
}

TEST(ProtocolTest, OversizedLineIsRejectedWithoutParsing) {
    ProtocolProcessor processor;
    const std::string oversized(max_protocol_line_bytes + 1U, 'x');

    const Json response = Json::parse(processor.process_line(oversized));

    EXPECT_FALSE(response.at("accepted").get<bool>());
    EXPECT_EQ(response.at("rejection").at("code"), "MESSAGE_TOO_LARGE");
}

TEST(ProtocolTest, AllCrossProcessIntegersAreDecimalStrings) {
    ProtocolProcessor processor;
    const auto sell = processor.process_line(
        R"({"protocolVersion":1,"commandId":"00000000-0000-4000-8000-000000000020","type":"ADD_ORDER","payload":{"orderId":"20000000-0000-4000-8000-000000000001","participantId":"seller","instrumentKey":"NSE_EQ|INE002A01018","side":"SELL","orderType":"LIMIT","quantity":"1","limitPricePaise":"9007199254740993"}})");
    const auto buy = processor.process_line(
        R"({"protocolVersion":1,"commandId":"00000000-0000-4000-8000-000000000021","type":"ADD_ORDER","payload":{"orderId":"20000000-0000-4000-8000-000000000002","participantId":"buyer","instrumentKey":"NSE_EQ|INE002A01018","side":"BUY","orderType":"MARKET","quantity":"1"}})");

    EXPECT_TRUE(Json::parse(sell).at("accepted").get<bool>());
    const Json response = Json::parse(buy);
    EXPECT_TRUE(response.at("accepted").get<bool>());
    EXPECT_TRUE(response.at("result").at("fills")[0].at("pricePaise").is_string());
    EXPECT_EQ(response.at("result").at("fills")[0].at("pricePaise"), "9007199254740993");
}

}  // namespace
}  // namespace paper::matching
