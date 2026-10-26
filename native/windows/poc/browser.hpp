#pragma once
#include "platform.hpp"
namespace neige {
struct BrowserPilot {
    Job job;
    Child child;
    Handle channel;
    std::string pending;
    bool extendRequested = false;
    std::filesystem::path executable, entry, userData, vault;
    void prepare(const Staging &staging, const std::filesystem::path &projectRoot);
    void launch(Firewall &firewall, bool selfTest = false);
    void proxyTest(Firewall &firewall);
    std::pair<std::string, std::string> credentials();
    void ready(Firewall &firewall, uint16_t port, const std::string &token);
    void state(const std::string &value);
    bool wantsStop();
    void stop();
    void send(const std::string &frame);
    std::string poll();
    std::string wait(DWORD milliseconds);
};
int browserTest(const std::filesystem::path &projectRoot);
} // namespace neige
