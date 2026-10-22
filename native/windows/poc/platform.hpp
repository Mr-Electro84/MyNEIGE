#pragma once
#include "common.hpp"
namespace neige {
struct Adapter {
    uint32_t index = 0;
    uint64_t luid = 0;
    uint32_t address = 0;
    bool preferred = false;
    std::string name;
    std::vector<uint32_t> dns;
};
std::vector<Adapter> adapters();
Adapter adapterFor(uint32_t address);
Adapter idleAdapterByName(const std::wstring &name);
Socket vpnSocket(const Adapter &adapter, int type, int protocol);
std::vector<uint32_t> resolveVpn(const Adapter &adapter, const std::vector<uint32_t> &dns, const std::string &host);
struct NetworkSnapshot {
    std::set<std::string> routes;
    std::map<uint64_t, std::string> interfaces;
    static NetworkSnapshot capture(uint64_t excludeLuid = 0);
};
std::string interfaceSignature(const Adapter &adapter, const MIB_IPINTERFACE_ROW &row);
struct OwnedRoute {
    MIB_IPFORWARD_ROW2 row{};
    bool created = false;
    void add(const Adapter &adapter, uint32_t gateway);
    void remove();
    ~OwnedRoute();
};
struct Child {
    Handle process, input, output;
    DWORD pid = 0;
    Child() = default;
    Child(Child &&) = default;
    Child &operator=(Child &&) = default;
    ~Child();
    bool running() const;
    void stop();
    std::string line(DWORD milliseconds);
};
struct Job {
    Handle handle;
    Job();
    Child spawn(const std::wstring &executable, const std::vector<std::wstring> &args, bool captureOutput = true);
};
struct Staging {
    std::filesystem::path directory, executable, profile;
    Staging();
    ~Staging();
};
struct Firewall {
    HANDLE engine = nullptr;
    bool owns = false;
    Firewall();
    ~Firewall();
    void install(const std::wstring &executable, const Adapter *vpn);
    void allowVpn(const std::wstring &executable, const Adapter &vpn);
    void clear();
    static void recover();
};
void validateOpenVpn(const std::filesystem::path &executable);
DWORD tcpOwner(const sockaddr_in &local, const sockaddr_in &remote);
uint32_t defaultInterfaceFor(uint32_t destination);
void recoverStaging();
void removeOwnedTap(Job &job, const std::filesystem::path &tool, const std::wstring &name);
} // namespace neige
