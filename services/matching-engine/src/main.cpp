#include <iostream>
#include <string>
#include <string_view>

#include "matching_engine/protocol.hpp"

int main() {
    paper::matching::ProtocolProcessor processor(
        [](const std::string_view message) { std::cerr << message << '\n'; });

    std::string line;
    while (std::getline(std::cin, line)) {
        std::cout << processor.process_line(line) << '\n' << std::flush;
    }

    return std::cin.eof() ? 0 : 1;
}
