include(FetchContent)

option(MATCHER_ENABLE_SANITIZERS "Enable address and undefined-behavior sanitizers" OFF)

set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_Declare(
  nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
  URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(nlohmann_json)

function(configure_matcher_target target_name)
  target_compile_features(${target_name} PRIVATE cxx_std_20)

  if(MSVC)
    target_compile_options(${target_name} PRIVATE /W4 /permissive- /EHsc)
    if(MATCHER_ENABLE_SANITIZERS)
      target_compile_options(${target_name} PRIVATE /fsanitize=address)
    endif()
  else()
    target_compile_options(
      ${target_name}
      PRIVATE
        -Wall
        -Wextra
        -Wpedantic
        -Wconversion
        -Wsign-conversion
    )
    if(MATCHER_ENABLE_SANITIZERS)
      target_compile_options(${target_name} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
      target_link_options(${target_name} PRIVATE -fsanitize=address,undefined)
    endif()
  endif()
endfunction()

add_library(
  matching-engine-core
  src/matching_engine.cpp
  src/order_book.cpp
)
target_include_directories(matching-engine-core PUBLIC include)
configure_matcher_target(matching-engine-core)

add_library(matching-engine-protocol src/protocol.cpp)
target_include_directories(matching-engine-protocol PUBLIC include)
target_link_libraries(
  matching-engine-protocol
  PUBLIC matching-engine-core nlohmann_json::nlohmann_json
)
configure_matcher_target(matching-engine-protocol)

add_executable(matching-engine src/main.cpp)
target_link_libraries(matching-engine PRIVATE matching-engine-protocol)
configure_matcher_target(matching-engine)

if(BUILD_TESTING)
  set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
  FetchContent_Declare(
    googletest
    URL https://github.com/google/googletest/archive/refs/tags/v1.18.0.tar.gz
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  )
  FetchContent_MakeAvailable(googletest)

  include(GoogleTest)
  add_executable(
    matching-engine-tests
    tests/matching_engine_test.cpp
    tests/protocol_test.cpp
  )
  target_link_libraries(
    matching-engine-tests
    PRIVATE matching-engine-core matching-engine-protocol GTest::gtest_main
  )
  target_compile_definitions(
    matching-engine-tests
    PRIVATE MATCHER_FIXTURES_DIR="${PROJECT_SOURCE_DIR}/packages/contracts/fixtures/matcher-ipc"
  )
  configure_matcher_target(matching-engine-tests)
  gtest_discover_tests(matching-engine-tests)
endif()
