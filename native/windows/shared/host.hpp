#pragma once
#include "core.hpp"
namespace neige {
inline bool validHost(const std::string &host) {
    if (host.empty() || host.size() > 253 || host.back() == '.')
        return false;
    for (const auto &label : split(host, '.')) {
        if (label.empty() || label.size() > 63 || label.front() == '-' || label.back() == '-')
            return false;
        for (unsigned char c : label)
            if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-'))
                return false;
    }
    return true;
}
} // namespace neige
