#include "common.hpp"

namespace neige {
static bool numberField(const std::string &value, const std::string &prefix, unsigned maximum) {
    if (value.rfind(prefix, 0) != 0)
        return false;
    const auto number = value.substr(prefix.size());
    return !number.empty() && number.size() <= 6 && number.find_first_not_of("0123456789") == std::string::npos &&
           std::stoul(number) <= maximum;
}
bool safeRelayDiagnostic(const std::string &line) {
    if (line == "RELAY_CAPACITY limit=16" || line == "RELAY_CAPACITY limit=32" || line == "RELAY_CAPACITY limit=80")
        return true;
    const auto words = split(line, ' ');
    if (words.size() < 4 || line.size() > 420 || words[1].rfind("host=", 0) != 0 || !validHost(words[1].substr(5)))
        return false;
    if (words[0] == "RELAY_REQUEST_FAILED" && words.size() == 4) {
        static const std::set<std::string> stages{"stage=HEADER", "stage=AUTH", "stage=POLICY", "stage=DNS",
            "stage=ADDRESS", "stage=CONNECT", "stage=TUNNEL"};
        return stages.contains(words[2]) && numberField(words[3], "wsa=", 100000);
    }
    if (words[0] == "DNS_ATTEMPT_FAILED" && words.size() == 6) {
        static const std::set<std::string> stages{"stage=BIND", "stage=UDP_CONNECT", "stage=UDP_SEND",
            "stage=UDP_RECEIVE", "stage=UDP_PARSE", "stage=TCP_BIND_CONNECT", "stage=TCP_SEND",
            "stage=TCP_RECEIVE", "stage=TCP_PARSE"};
        static const std::set<std::string> reasons{"reason=RCODE", "reason=NO_IPV4", "reason=INVALID_RESPONSE",
            "reason=TRANSPORT"};
        return stages.contains(words[2]) && numberField(words[3], "wsa=", 100000) &&
               numberField(words[4], "rcode=", 15) && reasons.contains(words[5]);
    }
    return false;
}
std::string browserRequestDiagnostic(const std::string &line) {
    const auto words = split(line, ' ');
    if (words.size() < 3 || line.size() > 360 || !validHost(words[1]))
        return {};
    static const std::set<std::string> types{"mainFrame", "subFrame", "stylesheet", "script", "image", "font",
        "object", "xhr", "ping", "cspReport", "media", "webSocket", "other"};
    if (!types.contains(words[2]))
        return {};
    if (words[0] == "UI_REQUEST_BLOCKED" && words.size() == 3)
        return "BROWSER_REQUEST_BLOCKED host=" + words[1] + " type=" + words[2];
    if (words[0] == "UI_REQUEST_ERROR" && words.size() == 4 && words[3].size() <= 50 &&
        (words[3] == "OTHER" || words[3].rfind("ERR_", 0) == 0) &&
        words[3].find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789") == std::string::npos)
        return "BROWSER_REQUEST_ERROR host=" + words[1] + " type=" + words[2] + " error=" + words[3];
    return {};
}
} // namespace neige
