#include "common.hpp"
namespace neige {
std::string managementFrame(const std::string &value) {
    require(!value.empty() && value.size() < 8192 && value.find_first_of("\r\n") == std::string::npos &&
                value.find('\0') == std::string::npos,
            "Invalid management command frame");
    return value + "\r\n";
}
std::string managementQuote(const std::string &value) {
    require(!value.empty() && value.size() <= 2048, "Credential length invalid");
    std::string output = "\"";
    for (unsigned char c : value) {
        require(c >= 32 && c != 127, "Control characters are not permitted in credentials");
        if (c == '\\' || c == '"')
            output += '\\';
        output += static_cast<char>(c);
    }
    output += '"';
    return output;
}
} // namespace neige
