#include "vpn-profile.hpp"
#include "host.hpp"
#include <map>
#include <set>
#include <wincrypt.h>
namespace neige {
std::string normalizeProfile(const std::string &source) {
    require(source.size() < 65536 && source.find('\0') == std::string::npos, "Profile too large or contains NUL");
    const std::map<std::string, std::string> allowed = {{"dev", "tun"},
                                                        {"persist-tun", ""},
                                                        {"persist-key", ""},
                                                        {"tls-client", ""},
                                                        {"client", ""},
                                                        {"resolv-retry", "infinite"},
                                                        {"auth-user-pass", ""},
                                                        {"remote-cert-tls", "server"},
                                                        {"setenv", "CLIENT_CERT 0"}};
    std::set<std::string> seen;
    std::map<std::string, std::string> values;
    bool ca = false, caDone = false;
    std::string caData;
    std::istringstream input(source.starts_with("\xEF\xBB\xBF") ? source.substr(3) : source);
    std::string line;
    while (std::getline(input, line)) {
        line = trim(line);
        if (line.empty())
            continue;
        if (ca) {
            if (line == "</ca>") {
                ca = false;
                caDone = true;
            } else {
                require(caData.size() < 20000, "CA block too large");
                caData += line + "\n";
            }
            continue;
        }
        if (line[0] == '#' || line[0] == ';')
            continue;
        if (line == "<ca>") {
            require(!caDone, "Duplicate CA");
            ca = true;
            continue;
        }
        auto space = line.find_first_of(" \t");
        auto key = line.substr(0, space);
        auto value = space == std::string::npos ? "" : trim(line.substr(space));
        require(seen.insert(key).second, "Duplicate profile directive");
        if (key == "remote") {
            std::istringstream words(value);
            std::string host, port, proto, extra;
            words >> host >> port >> proto >> extra;
            require(validHost(host) && !port.empty() && port.size() <= 5 &&
                        port.find_first_not_of("0123456789") == std::string::npos &&
                        std::stoul(port) > 0 && std::stoul(port) <= 65535 && extra.empty() &&
                        (proto.empty() || proto == "tcp-client" || proto == "tcp4-client"),
                    "Single TCP VPN server required");
            values[key] = lower(host) + " " + std::to_string(std::stoul(port));
        } else if (key == "proto") {
            require(value == "tcp-client" || value == "tcp4-client", "TCP client transport required");
        } else if (key == "cipher" || key == "ncp-ciphers" || key == "data-ciphers") {
            const std::set<std::string> ciphers{"AES-128-GCM", "AES-192-GCM", "AES-256-GCM",
                "AES-128-CBC", "AES-192-CBC", "AES-256-CBC", "CHACHA20-POLY1305"};
            require(!value.empty() && value.size() <= 256 && value.back() != ':', "Invalid cipher list");
            const auto parts = split(value, ':');
            require(key != "cipher" || parts.size() == 1, "Single legacy cipher required");
            for (const auto &part : parts)
                require(ciphers.contains(part), "Unsupported cipher");
            values[key] = value;
        } else if (key == "auth") {
            require(value == "SHA256" || value == "SHA384" || value == "SHA512", "Unsupported message digest");
            values[key] = value;
        } else {
            const auto found = allowed.find(key);
            require(found != allowed.end() && found->second == value,
                    "Profile directive unsupported; no external scripts, files or network overrides permitted");
        }
    }
    require(!ca && caDone && caData.find("-----BEGIN CERTIFICATE-----\n") == 0 &&
                caData.find("-----END CERTIFICATE-----") != std::string::npos,
            "Missing or invalid CA block");
    require(caData.find("PRIVATE") == std::string::npos && caData.find('<') == std::string::npos,
            "Unexpected content in CA");
    // Le certificat est fourni par l'utilisateur : aucune CA universitaire connue ou attendue.
    const auto end = caData.find("-----END CERTIFICATE-----\n");
    require(end != std::string::npos && end + 26 == caData.size(), "Single PEM CA required");
    DWORD derSize = 0;
    require(CryptStringToBinaryA(caData.c_str(), static_cast<DWORD>(caData.size()), CRYPT_STRING_BASE64HEADER,
                                nullptr, &derSize, nullptr, nullptr) && derSize <= 20000, "Invalid PEM CA");
    Bytes der(derSize);
    require(CryptStringToBinaryA(caData.c_str(), static_cast<DWORD>(caData.size()), CRYPT_STRING_BASE64HEADER,
                                der.data(), &derSize, nullptr, nullptr) != 0, "Invalid CA encoding");
    auto certificate = CertCreateCertificateContext(X509_ASN_ENCODING, der.data(), derSize);
    require(certificate != nullptr, "Invalid X509 CA");
    CertFreeCertificateContext(certificate);
    for (const char *key : {"client", "dev", "remote", "auth-user-pass", "remote-cert-tls", "auth"})
        require(seen.count(key) == 1, "Required profile directive missing");
    require(seen.contains("ncp-ciphers") != seen.contains("data-ciphers"), "One negotiated cipher list required");
    const auto ciphers = values.at(seen.contains("data-ciphers") ? "data-ciphers" : "ncp-ciphers");
    // Reconstruction uniquement depuis les données admises ; les protections appartiennent à MyNEIGE.
    return "client\ndev tun\nproto tcp4-client\nremote " + values.at("remote") + "\n"
           "resolv-retry 10\nnobind\nauth-user-pass\nauth-nocache\nauth-retry none\nremote-cert-tls server\n"
           "data-ciphers " + ciphers + "\nauth " + values.at("auth") + "\nallow-compression no\n"
           "route-nopull\nroute-noexec\nip-win32 netsh\npull-filter ignore \"dns\"\nscript-security 1\n"
           "verb 3\nconnect-retry-max 1\nconnect-timeout 20\n<ca>\n" +
           caData + "</ca>\n";
}
} // namespace neige
