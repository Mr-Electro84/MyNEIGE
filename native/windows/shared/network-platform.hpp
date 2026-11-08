#pragma once
#include "network.hpp"
namespace neige {
struct Adapter {
    uint32_t index = 0;
    uint64_t luid = 0;
    uint32_t address = 0;
    bool preferred = false;
    std::string name;
    std::string guid;
    std::vector<uint32_t> dns;
};
std::vector<Adapter> adapters();
Adapter adapterFor(uint32_t address);
Socket vpnSocket(const Adapter &adapter, int type, int protocol);
Socket boundNetworkSocket(const Adapter &adapter, int type, int protocol);
std::vector<uint32_t> resolveVpn(const Adapter &adapter, const std::vector<uint32_t> &dns, const std::string &host,
                               bool publicNetwork = false);
std::vector<uint32_t> resolveVpnTcp(const Adapter &adapter, const std::vector<uint32_t> &dns, const std::string &host);
void reportFlow(const char *role, const char *protocol, SOCKET socket, uint32_t destination, uint16_t port);
} // namespace neige
