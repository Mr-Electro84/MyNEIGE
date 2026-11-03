#pragma once
#include "core.hpp"
namespace neige {
std::string sha256File(const std::filesystem::path &path);
std::string sha256Text(const std::string &text);
}
