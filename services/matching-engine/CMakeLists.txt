add_executable(matching-engine src/main.cpp)

target_compile_features(matching-engine PRIVATE cxx_std_20)

if(MSVC)
  target_compile_options(matching-engine PRIVATE /W4 /permissive- /EHsc)
else()
  target_compile_options(matching-engine PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion)
endif()

if(BUILD_TESTING)
  add_test(NAME matching_engine_ping COMMAND matching-engine --ping)
  set_tests_properties(matching_engine_ping PROPERTIES PASS_REGULAR_EXPRESSION "^PONG")
endif()

