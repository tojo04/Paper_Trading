#pragma once

#include <cstddef>
#include <string>

#include "matching_engine/matching_engine.hpp"

namespace paper::matching {

inline constexpr std::size_t max_protocol_line_bytes = 1U << 20U;

class ProtocolProcessor {
  public:
    explicit ProtocolProcessor(Logger logger = {});

    [[nodiscard]] std::string process_line(const std::string& line);

  private:
    Logger logger_;
    MatchingEngine engine_;
};

}  // namespace paper::matching

