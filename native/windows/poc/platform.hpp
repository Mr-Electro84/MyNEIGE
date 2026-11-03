#pragma once
#include "common.hpp"
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
Adapter idleAdapterByName(const std::wstring &name);
Socket vpnSocket(const Adapter &adapter, int type, int protocol);
Adapter publicNetwork();
Socket boundNetworkSocket(const Adapter &adapter, int type, int protocol);
std::vector<uint32_t> resolveVpn(const Adapter &adapter, const std::vector<uint32_t> &dns, const std::string &host,
                               bool publicNetwork = false);
std::vector<uint32_t> resolveVpnTcp(const Adapter &adapter, const std::vector<uint32_t> &dns, const std::string &host);
void reportFlow(const char *role, const char *protocol, SOCKET socket, uint32_t destination, uint16_t port);
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
    std::string pendingOutput;
    DWORD pid = 0;
    Child() = default;
    Child(Child &&) = default;
    Child &operator=(Child &&) = default;
    ~Child();
    bool running() const;
    void stop();
    std::string line(DWORD milliseconds);
    std::string pollLine();
};
struct Job {
    Handle handle;
    Job();
    void terminate();
    Child spawn(const std::wstring &executable, const std::vector<std::wstring> &args, bool captureOutput = true,
                bool restricted = false);
};
struct Staging {
    std::filesystem::path directory, executable, profile, publicExecutable;
    Staging();
    ~Staging();
    void allowUserRead();
};
struct Firewall {
    HANDLE engine = nullptr;
    bool owns = false;
    std::map<std::wstring, uint64_t> browserPermits;
    Firewall();
    ~Firewall();
    void install(const std::wstring &executable, const Adapter *vpn);
    void allowVpn(const std::wstring &executable, const Adapter &vpn);
    void allowPublicRelay(const std::wstring &executable, const Adapter &network);
    void quarantineBrowser(const std::wstring &executable);
    void allowBrowserProxy(const std::wstring &executable, uint16_t port);
    void revokeBrowserProxy(const std::wstring &executable);
    void clear();
    static void recover();
};
std::string relayConfiguration(const Adapter &network, const std::vector<uint32_t> &dns, const std::string &host,
                               const std::string &token, const std::string &scope, uint16_t publicPort = 0);
struct PublicRelay {
    Child child;
    uint16_t port = 0;
    void start(Job &job, Firewall &firewall, Staging &staging, const Adapter &network, const std::string &token);
};
void publicRelayChecks(Job &job, Firewall &firewall, Staging &staging);
void validateOpenVpn(const std::filesystem::path &executable);
DWORD tcpOwner(const sockaddr_in &local, const sockaddr_in &remote);
void reportTransport(DWORD pid);
uint32_t defaultInterfaceFor(uint32_t destination);
void recoverStaging();
void removeOwnedTap(Job &job, const std::filesystem::path &tool, const std::wstring &name);
Handle restrictedToken();
std::wstring currentUserSid();
void selectInteractiveUser();
std::filesystem::path interactiveLocalAppData();
void grantUserRead(const std::filesystem::path &path);
void removeProtectedTree(const std::filesystem::path &path, const std::filesystem::path &sessionRoot,
                         bool runtimeCacheCleanup = false);
void verifyProtectedDirectory(const std::filesystem::path &path, bool runtimeCacheCleanup = false);
void createProtectedDirectory(const std::filesystem::path &path);
void requirePrivilegedParent();
int securityProbe();
int privilegeTest();
void protectSupervisor();
} // namespace neige
