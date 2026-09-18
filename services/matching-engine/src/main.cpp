#include <iostream>
#include <string>
#include <string_view>

namespace {

constexpr std::string_view kPing = "PING";
constexpr std::string_view kPong = "PONG";

int run_stdin_harness() {
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line == kPing) {
            std::cout << kPong << '\n' << std::flush;
            continue;
        }

        std::cerr << "unsupported harness command\n";
        return 2;
    }

    return 0;
}

}  // namespace

int main(const int argument_count, const char* const arguments[]) {
    if (argument_count == 2 && std::string_view(arguments[1]) == "--ping") {
        std::cout << kPong << '\n';
        return 0;
    }

    if (argument_count != 1) {
        std::cerr << "usage: matching-engine [--ping]\n";
        return 2;
    }

    return run_stdin_harness();
}

