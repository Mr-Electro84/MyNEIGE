#include "network.hpp"
#include "hash.hpp"
namespace neige {
static bool domainHost(const std::string &host, const std::string &domain) {
    const auto suffix = "." + domain;
    return host == domain ||
           (host.size() > suffix.size() && host.compare(host.size() - suffix.size(), suffix.size(), suffix) == 0);
}
bool universityHost(const std::string &host) {
    const std::string suffix = ".univ-avignon.fr";
    return validHost(host) &&
           (host == "univ-avignon.fr" ||
            (host.size() > suffix.size() && host.compare(host.size() - suffix.size(), suffix.size(), suffix) == 0));
}
bool publicServiceHost(const std::string &host) {
    if (!validHost(host))
        return false;
    // Le relais voit seulement CONNECT : Electron impose en complément les
    // contextes des lecteurs externes et les deux URL de l'API MyNEIGE.
    if (host == "partage.univ-avignon.fr" || host == "my-neige.42web.io")
        return true;
    for (const auto &domain : {"renater.fr", "youtube.com", "youtube-nocookie.com",
                               "googlevideo.com", "ytimg.com", "h5p.com", "h5p.org", "h5p.io"})
        if (domainHost(host, domain))
            return true;
    static const std::set<std::string> resources{"youtubei.googleapis.com", "youtube.googleapis.com",
        "jnn-pa.googleapis.com", "yt3.ggpht.com", "www.gstatic.com", "fonts.gstatic.com",
        "fonts.googleapis.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "www.google.com"};
    return resources.contains(host);
}
bool browserHost(const std::string &host) {
    return universityHost(host) || publicServiceHost(host);
}
bool publicDestination(uint32_t ip) {
    // La sortie publique ne donne pas accès au réseau local, au tunnel, aux
    // plages privées, de documentation, de test ou réservées.
    const auto first = ip >> 24;
    return first != 0 && first != 10 && first != 127 && first < 224 &&
        (ip & 0xffc00000) != 0x64400000 && (ip & 0xffff0000) != 0xa9fe0000 &&
        (ip & 0xfff00000) != 0xac100000 && (ip & 0xffffff00) != 0xc0000000 &&
        (ip & 0xffffff00) != 0xc0000200 && (ip & 0xffff0000) != 0xc0a80000 &&
        (ip & 0xfffe0000) != 0xc6120000 && (ip & 0xffffff00) != 0xc6336400 &&
        (ip & 0xffffff00) != 0xcb007100;
}
std::string publicConnectHeader(const std::string &host, const std::string &authorization) {
    require(publicServiceHost(host), "Protected host cannot enter the public relay");
    require(authorization.rfind("Basic ", 0) == 0 && authorization.size() <= 256 &&
                authorization.find_first_of("\r\n") == std::string::npos,
            "Invalid internal proxy authentication");
    return "CONNECT " + host + ":443 HTTP/1.1\r\nHost: " + host +
           ":443\r\nProxy-Authorization: " + authorization + "\r\n\r\n";
}
static uint16_t u16(const Bytes &data, size_t offset) {
    require(offset + 2 <= data.size(), "Truncated DNS field");
    return static_cast<uint16_t>((data[offset] << 8) | data[offset + 1]);
}
static void put16(Bytes &data, uint16_t number) {
    data.push_back(static_cast<unsigned char>(number >> 8));
    data.push_back(static_cast<unsigned char>(number & 255));
}
static std::string dnsName(const Bytes &data, size_t &offset) {
    size_t cursor = offset;
    size_t end = 0;
    unsigned hops = 0;
    std::string name;
    while (true) {
        require(cursor < data.size() && ++hops <= 128, "Malformed DNS name");
        unsigned length = data[cursor++];
        if ((length & 0xc0) == 0xc0) {
            require(cursor < data.size(), "Truncated DNS pointer");
            size_t target = ((length & 0x3f) << 8) | data[cursor++];
            if (!end)
                end = cursor;
            require(target < cursor - 2, "DNS compression pointer is not backward");
            cursor = target;
            continue;
        }
        require((length & 0xc0) == 0 && length <= 63 && cursor + length <= data.size(), "Invalid DNS label");
        if (!length)
            break;
        if (!name.empty())
            name += '.';
        name.append(reinterpret_cast<const char *>(data.data() + cursor), length);
        cursor += length;
        require(name.size() <= 253, "DNS name too long");
    }
    offset = end ? end : cursor;
    return lower(name);
}
Bytes dnsQuery(const std::string &name, uint16_t id) {
    require(validHost(name), "Invalid DNS hostname");
    Bytes output;
    put16(output, id);
    put16(output, 0x0100);
    put16(output, 1);
    put16(output, 0);
    put16(output, 0);
    put16(output, 0);
    for (auto &label : split(name, '.')) {
        output.push_back(static_cast<unsigned char>(label.size()));
        output.insert(output.end(), label.begin(), label.end());
    }
    output.push_back(0);
    put16(output, 1);
    put16(output, 1);
    return output;
}
std::vector<uint32_t> dnsParse(const Bytes &packet, uint16_t id, const std::string &name, bool &truncated) {
    require(packet.size() >= 12 && u16(packet, 0) == id, "DNS transaction mismatch");
    uint16_t flags = u16(packet, 2);
    require((flags & 0x8000) && !(flags & 0x7800) && (flags & 15) == 0 && u16(packet, 4) == 1, "DNS response rejected");
    size_t offset = 12;
    require(dnsName(packet, offset) == lower(name), "DNS question mismatch");
    require(u16(packet, offset) == 1 && u16(packet, offset + 2) == 1, "DNS question type mismatch");
    offset += 4;
    truncated = (flags & 0x0200) != 0;
    if (truncated)
        return {};
    unsigned answers = u16(packet, 6);
    require(answers <= 512, "Too many DNS answers");
    std::map<std::string, std::string> aliases;
    std::vector<std::pair<std::string, uint32_t>> addresses;
    for (unsigned i = 0; i < answers; ++i) {
        auto owner = dnsName(packet, offset);
        uint16_t type = u16(packet, offset), klass = u16(packet, offset + 2), length = u16(packet, offset + 8);
        offset += 10;
        require(offset + length <= packet.size(), "Truncated DNS answer");
        if (klass == 1 && type == 1) {
            require(length == 4, "Invalid DNS A record");
            uint32_t ip = (uint32_t(packet[offset]) << 24) | (uint32_t(packet[offset + 1]) << 16) |
                          (uint32_t(packet[offset + 2]) << 8) | packet[offset + 3];
            addresses.emplace_back(owner, ip);
        }
        if (klass == 1 && type == 5) {
            size_t aliasOffset = offset;
            auto target = dnsName(packet, aliasOffset);
            require(aliasOffset == offset + length && validHost(target), "Invalid CNAME");
            require(aliases.emplace(owner, target).second, "Duplicate DNS alias");
        }
        offset += length;
    }
    std::string canonical = lower(name);
    std::set<std::string> chain{canonical};
    for (unsigned i = 0; aliases.count(canonical); ++i) {
        require(i < 16, "DNS CNAME chain too long");
        canonical = aliases.at(canonical);
        require(chain.insert(canonical).second, "DNS CNAME loop");
    }
    std::vector<uint32_t> result;
    for (auto &[owner, ip] : addresses)
        if (owner == canonical && std::find(result.begin(), result.end(), ip) == result.end())
            result.push_back(ip);
    require(!result.empty(), "No usable IPv4 DNS answer");
    return result;
}
std::string basic64(const std::string &text) {
    static const char *alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string result;
    for (size_t i = 0; i < text.size(); i += 3) {
        unsigned n = unsigned(static_cast<unsigned char>(text[i])) << 16;
        if (i + 1 < text.size())
            n |= unsigned(static_cast<unsigned char>(text[i + 1])) << 8;
        if (i + 2 < text.size())
            n |= static_cast<unsigned char>(text[i + 2]);
        result += alphabet[(n >> 18) & 63];
        result += alphabet[(n >> 12) & 63];
        result += i + 1 < text.size() ? alphabet[(n >> 6) & 63] : '=';
        result += i + 2 < text.size() ? alphabet[n & 63] : '=';
    }
    return result;
}
bool constantEqual(const std::string &a, const std::string &b) {
    if (a.size() != b.size())
        return false;
    unsigned difference = 0;
    for (size_t i = 0; i < a.size(); ++i)
        difference |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
    return difference == 0;
}
std::string sshProxyAuthorization(const std::string &token) {
    auto capability = lower(sha256Text("MyNEIGE SSH v1\n" + token));
    auto result = "Basic " + basic64("myneige-ssh:" + capability);
    wipe(capability);
    return result;
}
bool authorizedConnect(const ConnectRequest &request, const std::string &web, const std::string &ssh) {
    return request.port == 22 ? request.host == "pedago.univ-avignon.fr" && !ssh.empty() &&
        constantEqual(request.authorization, ssh) : request.port == 443 && constantEqual(request.authorization, web);
}
ConnectRequest parseConnect(const std::string &header, bool allowSsh) {
    require(header.size() >= 4 && header.size() <= 16384 && header.find("\r\n\r\n") == header.size() - 4 &&
                header.find('\0') == std::string::npos,
            "Invalid proxy header");
    std::istringstream lines(header);
    std::string line;
    require(bool(std::getline(lines, line)), "Missing request line");
    if (!line.empty() && line.back() == '\r')
        line.pop_back();
    auto parts = split(line, ' ');
    require(parts.size() == 3 && parts[0] == "CONNECT" && parts[2] == "HTTP/1.1",
            "Only CONNECT HTTP/1.1 is supported in the pilot");
    auto colon = parts[1].rfind(':');
    require(colon != std::string::npos, "CONNECT port required");
    ConnectRequest result{lower(parts[1].substr(0, colon)), {}};
    require(validHost(result.host), "Invalid CONNECT hostname");
    const auto port = parts[1].substr(colon + 1);
    require(port == "443" || (allowSsh && port == "22" && result.host == "pedago.univ-avignon.fr"),
            "CONNECT destination refused");
    result.port = port == "22" ? 22 : 443;
    bool authSeen = false;
    while (std::getline(lines, line)) {
        if (line == "\r" || line.empty())
            break;
        require(line.back() == '\r' && line[0] != ' ' && line[0] != '\t', "Malformed proxy header");
        line.pop_back();
        auto separator = line.find(':');
        require(separator != std::string::npos && separator > 0, "Malformed proxy header");
        auto key = lower(line.substr(0, separator));
        auto value = trim(line.substr(separator + 1));
        for (unsigned char c : line)
            require(c >= 32 && c != 127, "Proxy control character");
        require(key != "content-length" && key != "transfer-encoding", "CONNECT body is not supported");
        if (key == "proxy-authorization") {
            require(!authSeen, "Duplicate proxy authentication");
            authSeen = true;
            result.authorization = value;
        }
    }
    return result;
}
} // namespace neige
