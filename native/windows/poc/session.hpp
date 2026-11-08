#pragma once
#include "platform.hpp"
#include "session-lifetime.hpp"
namespace neige {
struct PushOptions {
    std::vector<uint32_t> dns;
    uint32_t gateway = 0;
    bool unsupportedDnsPolicy = false;
    void observe(const std::string &managementLine);
};
bool isCipherFailure(const std::string &line);
std::string safeDiagnostic(const std::string &line);
struct Options {
    std::filesystem::path profile;
    std::filesystem::path openvpn = L"C:\\Program Files\\OpenVPN\\bin\\openvpn.exe";
    std::vector<uint32_t> dns;
    uint32_t gateway = 0;
    unsigned seconds = 30;
    bool authenticationProbe = false;
    bool localManagementTest = false;
    bool qualification = false;
    bool crashAfterProbes = false;
    bool browserMode = false;
    std::filesystem::path projectRoot = std::filesystem::current_path();
};
int wfpTest();
int adapterTest(const Options &options);
int connectSession(const Options &options);
int inspect(const Options &options);
int publicNetworkTest();
Handle sessionMutex();
} // namespace neige
