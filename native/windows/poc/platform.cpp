#include <initguid.h>
#include "platform.hpp"
#include <aclapi.h>
#include <shlobj.h>
#include <knownfolders.h>
#include <wintrust.h>
#include <softpub.h>

namespace neige {
static const GUID Provider = {0xcf8ad1ce, 0x0577, 0x45df, {0xb1, 0x7e, 0x40, 0x3b, 0x9c, 0x18, 0x7a, 0x31}};
static const GUID Sublayer = {0x3e8cdad0, 0xbc72, 0x4263, {0xa0, 0x67, 0x77, 0xb1, 0x4c, 0xa9, 0x0a, 0x18}};
static constexpr ULONG RouteMetric = 60000;

std::vector<Adapter> adapters() {
    ULONG length = 16384;
    Bytes storage(length);
    ULONG code = GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_PREFIX, nullptr,
                                      reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data()), &length);
    if (code == ERROR_BUFFER_OVERFLOW) {
        storage.resize(length);
        code = GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_PREFIX, nullptr,
                                    reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data()), &length);
    }
    wincheck(code, "GetAdaptersAddresses");
    std::vector<Adapter> result;
    for (auto p = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data()); p; p = p->Next) {
        if (p->OperStatus != IfOperStatusUp)
            continue;
        for (auto address = p->FirstUnicastAddress; address; address = address->Next) {
            if (address->Address.lpSockaddr->sa_family != AF_INET)
                continue;
            Adapter item;
            item.index = p->IfIndex;
            item.luid = p->Luid.Value;
            item.address = ntohl(reinterpret_cast<sockaddr_in *>(address->Address.lpSockaddr)->sin_addr.S_un.S_addr);
            item.preferred = address->DadState == IpDadStatePreferred;
            item.name = utf8(p->FriendlyName);
            for (auto dns = p->FirstDnsServerAddress; dns; dns = dns->Next)
                if (dns->Address.lpSockaddr->sa_family == AF_INET)
                    item.dns.push_back(
                        ntohl(reinterpret_cast<sockaddr_in *>(dns->Address.lpSockaddr)->sin_addr.S_un.S_addr));
            result.push_back(std::move(item));
        }
    }
    return result;
}
Adapter adapterFor(uint32_t address) {
    std::vector<Adapter> matches;
    for (auto &adapter : adapters())
        if (adapter.address == address)
            matches.push_back(adapter);
    require(matches.size() == 1, "VPN address does not identify exactly one active interface");
    require(matches[0].preferred, "VPN address is not yet preferred (DAD pending or failed)");
    MIB_IPINTERFACE_ROW row{};
    InitializeIpInterfaceEntry(&row);
    row.Family = AF_INET;
    row.InterfaceLuid.Value = matches[0].luid;
    wincheck(GetIpInterfaceEntry(&row), "GetIpInterfaceEntry");
    require(!row.WeakHostSend && !row.WeakHostReceive, "Weak-host VPN interface is not supported by this pilot");
    return matches[0];
}
Adapter idleAdapterByName(const std::wstring &name) {
    ULONG size = 16384;
    Bytes storage(size);
    auto code = GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_ALL_INTERFACES, nullptr,
                                     reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data()), &size);
    if (code == ERROR_BUFFER_OVERFLOW) {
        storage.resize(size);
        code = GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_ALL_INTERFACES, nullptr,
                                    reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data()), &size);
    }
    wincheck(code, "Locate dedicated TAP adapter");
    for (auto p = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data()); p; p = p->Next)
        if (name == p->FriendlyName) {
            require(wcsstr(p->Description, L"TAP-Windows") != nullptr,
                    "Dedicated adapter does not identify a TAP driver");
            require(p->FirstUnicastAddress == nullptr,
                    "Dedicated adapter unexpectedly already has an IPv4 configuration");
            Adapter result;
            result.index = p->IfIndex;
            result.luid = p->Luid.Value;
            result.name = utf8(name);
            require(result.index && result.luid, "Dedicated TAP identity unavailable");
            return result;
        }
    throw std::runtime_error("Dedicated TAP adapter is not yet enumerated");
}
Socket vpnSocket(const Adapter &adapter, int type, int protocol) {
    auto current = adapterFor(adapter.address);
    require(current.index == adapter.index && current.luid == adapter.luid, "Tunnel interface generation changed");
    Socket result(socket(AF_INET, type, protocol));
    require(result.s != INVALID_SOCKET, "Cannot create tunnel socket");
    DWORD index = htonl(adapter.index);
    const int selected =
        setsockopt(result.s, IPPROTO_IP, IP_UNICAST_IF, reinterpret_cast<const char *>(&index), sizeof(index));
    if (selected != 0)
        throw std::runtime_error("IP_UNICAST_IF failed (Winsock " + std::to_string(WSAGetLastError()) + ")");
    auto source = endpoint(adapter.address, 0);
    if (bind(result.s, reinterpret_cast<sockaddr *>(&source), sizeof(source)) != 0)
        throw std::runtime_error("Cannot bind VPN source (Winsock " + std::to_string(WSAGetLastError()) + ")");
    socketTimeout(result.s, 5000);
    return result;
}
std::vector<uint32_t> resolveVpn(const Adapter &adapter, const std::vector<uint32_t> &servers,
                                 const std::string &host) {
    require(!servers.empty() && servers.size() <= 4, "A reliable VPN DNS server is required");
    for (auto server : servers) {
        const char *stage = "BIND";
        unsigned responseCode = 0;
        try {
            auto random = randomHex(2);
            uint16_t id = static_cast<uint16_t>(std::stoul(random, nullptr, 16));
            auto query = dnsQuery(host, id);
            auto socket = vpnSocket(adapter, SOCK_DGRAM, IPPROTO_UDP);
            auto destination = endpoint(server, 53);
            stage = "UDP_CONNECT";
            require(connect(socket.s, reinterpret_cast<sockaddr *>(&destination), sizeof(destination)) == 0,
                    "DNS UDP connect failed");
            stage = "UDP_SEND";
            sendAll(socket.s, query.data(), query.size());
            Bytes packet(65535);
            stage = "UDP_RECEIVE";
            int count = recv(socket.s, reinterpret_cast<char *>(packet.data()), static_cast<int>(packet.size()), 0);
            require(count > 0, "VPN DNS did not answer");
            packet.resize(count);
            bool truncated = false;
            stage = "UDP_PARSE";
            responseCode = packet.size() >= 4 ? packet[3] & 15 : 0;
            auto result = dnsParse(packet, id, host, truncated);
            if (!truncated)
                return result;
            stage = "TCP_BIND_CONNECT";
            auto tcp = vpnSocket(adapter, SOCK_STREAM, IPPROTO_TCP);
            connectWithin(tcp.s, destination, 5000);
            unsigned char size[2]{static_cast<unsigned char>(query.size() >> 8),
                                  static_cast<unsigned char>(query.size() & 255)};
            stage = "TCP_SEND";
            sendAll(tcp.s, size, 2);
            sendAll(tcp.s, query.data(), query.size());
            stage = "TCP_RECEIVE";
            recvAll(tcp.s, size, 2);
            size_t length = (size[0] << 8) | size[1];
            require(length >= 12, "Short DNS TCP packet");
            packet.resize(length);
            recvAll(tcp.s, packet.data(), packet.size());
            stage = "TCP_PARSE";
            responseCode = packet.size() >= 4 ? packet[3] & 15 : 0;
            result = dnsParse(packet, id, host, truncated);
            require(!truncated, "Truncated DNS TCP answer");
            return result;
        } catch (const std::exception &error) {
            // Generated metadata only; no DNS names, records, management lines or secrets.
            const int code = WSAGetLastError();
            std::cout << "DNS_ATTEMPT_FAILED stage=" << stage << " wsa=" << code << " rcode=" << responseCode
                      << std::endl;
            // These failures contain only constants and numeric OS error codes from our own code.
            // This scope never consumes management messages or remote text.
            if (std::string(stage) == "BIND")
                std::cout << "DNS_BIND_FAILURE " << error.what() << std::endl;
            // Try only explicitly supplied tunnel DNS, never the system resolver.
        }
    }
    throw std::runtime_error("All VPN DNS servers failed; no system-DNS fallback was attempted");
}
static std::string sockaddrText(const SOCKADDR_INET &address) {
    if (address.si_family == AF_INET)
        return ipText(ntohl(address.Ipv4.sin_addr.S_un.S_addr));
    char buffer[INET6_ADDRSTRLEN]{};
    IN6_ADDR ip = address.Ipv6.sin6_addr;
    require(InetNtopA(AF_INET6, &ip, buffer, sizeof(buffer)) != nullptr, "IPv6 formatting failed");
    return buffer;
}
std::string interfaceSignature(const Adapter &adapter, const MIB_IPINTERFACE_ROW &row) {
    // Automatic metrics fluctuate with negotiated link speed (including Wi-Fi).
    // Keep the policy stable; fixed metrics remain part of the exact baseline.
    std::string value = ipText(adapter.address) + ":" +
                        (row.UseAutomaticMetric ? "automatic" : "fixed=" + std::to_string(row.Metric)) + ":" +
                        (row.WeakHostSend ? "weak-send" : "strong-send") + ":" +
                        (row.WeakHostReceive ? "weak-receive" : "strong-receive") + ":";
    for (auto dns : adapter.dns)
        value += ipText(dns) + ",";
    return value + ";";
}
NetworkSnapshot NetworkSnapshot::capture(uint64_t excludeLuid) {
    NetworkSnapshot result;
    PMIB_IPFORWARD_TABLE2 raw = nullptr;
    wincheck(GetIpForwardTable2(AF_UNSPEC, &raw), "GetIpForwardTable2");
    std::unique_ptr<MIB_IPFORWARD_TABLE2, decltype(&FreeMibTable)> table(raw, FreeMibTable);
    for (ULONG i = 0; i < table->NumEntries; ++i) {
        const auto &row = table->Table[i];
        if (row.InterfaceLuid.Value == excludeLuid)
            continue;
        result.routes.insert(std::to_string(row.InterfaceLuid.Value) + ":" +
                             sockaddrText(row.DestinationPrefix.Prefix) + "/" +
                             std::to_string(row.DestinationPrefix.PrefixLength) + ":" + sockaddrText(row.NextHop) +
                             ":" + std::to_string(row.Metric));
    }
    for (auto &adapter : adapters()) {
        if (adapter.luid == excludeLuid)
            continue;
        MIB_IPINTERFACE_ROW row{};
        InitializeIpInterfaceEntry(&row);
        row.Family = AF_INET;
        row.InterfaceLuid.Value = adapter.luid;
        wincheck(GetIpInterfaceEntry(&row), "Read interface metric");
        auto &value = result.interfaces[adapter.luid];
        value += interfaceSignature(adapter, row);
    }
    return result;
}
uint32_t defaultInterfaceFor(uint32_t destination) {
    SOCKADDR_INET address{};
    address.Ipv4 = endpoint(destination, 0);
    MIB_IPFORWARD_ROW2 route{};
    SOCKADDR_INET source{};
    wincheck(GetBestRoute2(nullptr, 0, nullptr, &address, 0, &route, &source), "GetBestRoute2");
    return route.InterfaceIndex;
}
void OwnedRoute::add(const Adapter &adapter, uint32_t gateway) {
    require(!created && gateway && gateway != adapter.address, "Invalid VPN next hop");
    MIB_IPINTERFACE_ROW iface{};
    InitializeIpInterfaceEntry(&iface);
    iface.Family = AF_INET;
    iface.InterfaceLuid.Value = adapter.luid;
    wincheck(GetIpInterfaceEntry(&iface), "Read VPN metric");
    PMIB_IPFORWARD_TABLE2 raw = nullptr;
    wincheck(GetIpForwardTable2(AF_INET, &raw), "Read default routes");
    std::unique_ptr<MIB_IPFORWARD_TABLE2, decltype(&FreeMibTable)> table(raw, FreeMibTable);
    bool physicalDefault = false;
    for (ULONG i = 0; i < table->NumEntries; ++i) {
        auto &candidate = table->Table[i];
        if (candidate.DestinationPrefix.PrefixLength != 0)
            continue;
        require(candidate.InterfaceLuid.Value != adapter.luid,
                "VPN already has a default route; pilot refuses to overwrite it");
        MIB_IPINTERFACE_ROW other{};
        InitializeIpInterfaceEntry(&other);
        other.Family = AF_INET;
        other.InterfaceLuid = candidate.InterfaceLuid;
        if (GetIpInterfaceEntry(&other) == NO_ERROR &&
            uint64_t(candidate.Metric) + other.Metric < uint64_t(RouteMetric) + iface.Metric)
            physicalDefault = true;
    }
    require(physicalDefault, "No preferred non-MyNEIGE default route; refusing to add a tunnel route");
    InitializeIpForwardEntry(&row);
    row.InterfaceLuid.Value = adapter.luid;
    row.InterfaceIndex = adapter.index;
    row.DestinationPrefix.Prefix.si_family = AF_INET;
    row.DestinationPrefix.PrefixLength = 0;
    row.NextHop.Ipv4 = endpoint(gateway, 0);
    row.Metric = RouteMetric;
    row.Protocol = MIB_IPPROTO_NETMGMT;
    row.ValidLifetime = 0xffffffff;
    row.PreferredLifetime = 0xffffffff;
    wincheck(CreateIpForwardEntry2(&row), "Create low-priority VPN route");
    created = true;
}
void OwnedRoute::remove() {
    if (created) {
        DWORD code = DeleteIpForwardEntry2(&row);
        if (code != NO_ERROR && code != ERROR_NOT_FOUND)
            wincheck(code, "Remove owned VPN route");
        created = false;
    }
}
OwnedRoute::~OwnedRoute() {
    if (created) {
        try {
            remove();
        } catch (...) {
            std::cerr << "Owned route cleanup failed; run cleanup before retrying.\n";
        }
    }
}

Child::~Child() {
    stop();
}
bool Child::running() const {
    return process.h && WaitForSingleObject(process.h, 0) == WAIT_TIMEOUT;
}
void Child::stop() {
    if (running()) {
        TerminateProcess(process.h, 1);
        WaitForSingleObject(process.h, 10000);
    }
    input.reset();
    output.reset();
    process.reset();
}
std::string Child::line(DWORD milliseconds) {
    auto deadline = GetTickCount64() + milliseconds;
    std::string line;
    while (GetTickCount64() < deadline) {
        DWORD available = 0;
        require(PeekNamedPipe(output.h, nullptr, 0, nullptr, &available, nullptr) != 0, "Child control pipe closed");
        if (available) {
            char c = 0;
            DWORD got = 0;
            require(ReadFile(output.h, &c, 1, &got, nullptr) && got, "Child pipe read failed");
            if (c == '\n')
                return trim(line);
            line += c;
            require(line.size() < 8192, "Child control line too large");
        } else {
            require(running(), "Child process exited before readiness");
            Sleep(10);
        }
    }
    throw std::runtime_error("Child readiness timed out");
}
Job::Job() : handle(CreateJobObjectW(nullptr, nullptr)) {
    require(handle.h != nullptr, "Cannot create process job");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    require(SetInformationJobObject(handle.h, JobObjectExtendedLimitInformation, &info, sizeof(info)) != 0,
            "Cannot enable kill-on-close job");
}
Child Job::spawn(const std::wstring &executable, const std::vector<std::wstring> &args, bool captureOutput) {
    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE read = nullptr, write = nullptr;
    require(CreatePipe(&read, &write, &sa, 0) != 0, "Cannot create input pipe");
    Handle inputRead(read), inputWrite(write);
    require(SetHandleInformation(inputWrite.h, HANDLE_FLAG_INHERIT, 0) != 0, "Cannot restrict input inheritance");
    Handle outputRead, outputWrite;
    if (captureOutput) {
        require(CreatePipe(&read, &write, &sa, 0) != 0, "Cannot create output pipe");
        outputRead = Handle(read);
        outputWrite = Handle(write);
        require(SetHandleInformation(outputRead.h, HANDLE_FLAG_INHERIT, 0) != 0, "Cannot restrict output inheritance");
    } else {
        outputWrite = Handle(
            CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, nullptr));
        require(outputWrite.h != INVALID_HANDLE_VALUE, "Cannot open NUL");
    }
    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
    Bytes attributes(bytes);
    auto list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
    require(InitializeProcThreadAttributeList(list, 1, 0, &bytes) != 0, "Cannot initialize process attributes");
    struct ListCleanup {
        LPPROC_THREAD_ATTRIBUTE_LIST p;
        ~ListCleanup() {
            DeleteProcThreadAttributeList(p);
        }
    } cleanup{list};
    HANDLE inherited[]{inputRead.h, outputWrite.h};
    require(UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), nullptr,
                                      nullptr) != 0,
            "Cannot restrict inherited handles");
    STARTUPINFOEXW info{};
    info.StartupInfo.cb = sizeof(info);
    info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    info.StartupInfo.hStdInput = inputRead.h;
    info.StartupInfo.hStdOutput = outputWrite.h;
    info.StartupInfo.hStdError = outputWrite.h;
    info.lpAttributeList = list;
    std::wstring command = quoteArgument(executable);
    for (auto &arg : args)
        command += L" " + quoteArgument(arg);
    PROCESS_INFORMATION process{};
    require(CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE,
                           CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, nullptr, nullptr,
                           &info.StartupInfo, &process) != 0,
            "Cannot start child process");
    Child result;
    result.process = Handle(process.hProcess);
    result.pid = process.dwProcessId;
    Handle thread(process.hThread);
    result.input = std::move(inputWrite);
    result.output = std::move(outputRead);
    require(AssignProcessToJobObject(handle.h, result.process.h) != 0, "Cannot supervise child process");
    require(ResumeThread(thread.h) != static_cast<DWORD>(-1), "Cannot resume child process");
    return result;
}
static std::filesystem::path protectedRoot() {
    PWSTR folder = nullptr;
    require(SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramData, 0, nullptr, &folder)), "Cannot locate ProgramData");
    std::filesystem::path root(folder);
    CoTaskMemFree(folder);
    return root / L"MyNEIGE-PoC";
}
static void verifyProtectedDirectory(const std::filesystem::path &directory) {
    Handle handle(CreateFileW(directory.c_str(), READ_CONTROL | FILE_READ_ATTRIBUTES,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
                              FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    require(handle.h != INVALID_HANDLE_VALUE, "Cannot inspect protected directory");
    FILE_ATTRIBUTE_TAG_INFO attributes{};
    require(GetFileInformationByHandleEx(handle.h, FileAttributeTagInfo, &attributes, sizeof(attributes)) != 0 &&
                !(attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT),
            "Refusing reparse point in staging");
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    PSID owner = nullptr;
    PACL dacl = nullptr;
    wincheck(GetSecurityInfo(handle.h, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &owner,
                             nullptr, &dacl, nullptr, &descriptor),
             "Read staging ACL");
    std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
    BYTE adminBuffer[SECURITY_MAX_SID_SIZE];
    DWORD length = sizeof(adminBuffer);
    require(CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, adminBuffer, &length) != 0 &&
                EqualSid(owner, adminBuffer),
            "Staging owner must be Administrators; refusing existing directory");
    require(dacl && dacl->AceCount == 2, "Unexpected staging ACL");
    BYTE systemBuffer[SECURITY_MAX_SID_SIZE];
    length = sizeof(systemBuffer);
    require(CreateWellKnownSid(WinLocalSystemSid, nullptr, systemBuffer, &length) != 0, "Cannot create SYSTEM SID");
    bool admin = false, system = false;
    for (DWORD i = 0; i < dacl->AceCount; ++i) {
        void *ace = nullptr;
        require(GetAce(dacl, i, &ace) != 0, "Cannot inspect ACL");
        auto allowed = static_cast<ACCESS_ALLOWED_ACE *>(ace);
        require(allowed->Header.AceType == ACCESS_ALLOWED_ACE_TYPE &&
                    (allowed->Mask & FILE_ALL_ACCESS) == FILE_ALL_ACCESS,
                "Unexpected staging ACE");
        auto sid = &allowed->SidStart;
        if (EqualSid(sid, adminBuffer))
            admin = true;
        else if (EqualSid(sid, systemBuffer))
            system = true;
        else
            throw std::runtime_error("Unexpected staging principal");
    }
    require(admin && system, "Incomplete staging ACL");
}
static void createProtectedDirectory(const std::filesystem::path &directory) {
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(L"O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)",
                                                                 SDDL_REVISION_1, &descriptor, nullptr) != 0,
            "Cannot create staging ACL");
    std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
    SECURITY_ATTRIBUTES sa{sizeof(sa), descriptor, FALSE};
    if (!CreateDirectoryW(directory.c_str(), &sa))
        require(GetLastError() == ERROR_ALREADY_EXISTS, "Cannot create protected directory");
    verifyProtectedDirectory(directory);
}
Staging::Staging() {
    auto root = protectedRoot();
    createProtectedDirectory(root);
    directory = root / wide("session-" + randomHex(16));
    createProtectedDirectory(directory);
    executable = directory / L"relay.exe";
    profile = directory / L"client.ovpn";
    require(CopyFileW(imagePath().c_str(), executable.c_str(), TRUE) != 0, "Cannot stage isolated relay image");
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(L"O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)",
                                                                 SDDL_REVISION_1, &descriptor, nullptr) != 0,
            "Cannot create relay file ACL");
    std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
    require(SetFileSecurityW(executable.c_str(),
                             OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                                 PROTECTED_DACL_SECURITY_INFORMATION,
                             descriptor) != 0,
            "Cannot protect staged relay file");
    verifyProtectedDirectory(executable);
}
Staging::~Staging() {
    if (!directory.empty() && !std::filesystem::exists(directory / L"tap-name.txt")) {
        DeleteFileW(executable.c_str());
        DeleteFileW(profile.c_str());
        RemoveDirectoryW(directory.c_str());
    }
}
void removeOwnedTap(Job &job, const std::filesystem::path &tool, const std::wstring &name) {
    require(name.size() == 44 && name.rfind(L"MyNEIGE-PoC-", 0) == 0 &&
                name.find_first_not_of(L"0123456789abcdef", 12) == std::wstring::npos,
            "Refusing an adapter name not owned by this pilot");
    NET_LUID luid{};
    auto code = ConvertInterfaceAliasToLuid(name.c_str(), &luid);
    if (code == ERROR_INVALID_PARAMETER || code == ERROR_NOT_FOUND || code == ERROR_FILE_NOT_FOUND)
        return;
    wincheck(code, "Inspect owned adapter before deletion");
    validateOpenVpn(tool);
    auto child = job.spawn(tool.wstring(), {L"delete", name}, false);
    require(WaitForSingleObject(child.process.h, 15000) == WAIT_OBJECT_0, "Dedicated adapter deletion timed out");
    DWORD exitCode = 1;
    require(GetExitCodeProcess(child.process.h, &exitCode) && exitCode == 0,
            "Dedicated adapter deletion failed; WFP protection retained");
    child.stop();
}
void recoverStaging() {
    auto root = protectedRoot();
    if (!std::filesystem::exists(root))
        return;
    verifyProtectedDirectory(root);
    for (const auto &entry : std::filesystem::directory_iterator(root)) {
        auto name = entry.path().filename().wstring();
        if (name.size() != 40 || name.substr(0, 8) != L"session-" ||
            name.find_first_not_of(L"0123456789abcdef", 8) != std::wstring::npos)
            continue;
        verifyProtectedDirectory(entry.path());
        auto journal = entry.path() / L"tap-name.txt";
        if (std::filesystem::exists(journal)) {
            std::ifstream input(journal);
            std::string adapterName;
            std::getline(input, adapterName);
            input.close();
            require(adapterName.size() == 44 && adapterName.rfind("MyNEIGE-PoC-", 0) == 0 &&
                        adapterName.find_first_not_of("0123456789abcdef", 12) == std::string::npos,
                    "Invalid protected adapter journal");
            auto tool = std::filesystem::path(L"C:\\Program Files\\OpenVPN\\bin\\tapctl.exe");
            Job job;
            removeOwnedTap(job, tool, wide(adapterName));
            require(DeleteFileW(journal.c_str()) != 0, "Cannot remove adapter recovery journal");
        }
        DeleteFileW((entry.path() / L"relay.exe").c_str());
        DeleteFileW((entry.path() / L"client.ovpn").c_str());
        RemoveDirectoryW(entry.path().c_str());
    }
}
static FWPM_FILTER_CONDITION0 appCondition(FWP_BYTE_BLOB *app) {
    FWPM_FILTER_CONDITION0 c{};
    c.fieldKey = FWPM_CONDITION_ALE_APP_ID;
    c.matchType = FWP_MATCH_EQUAL;
    c.conditionValue.type = FWP_BYTE_BLOB_TYPE;
    c.conditionValue.byteBlob = app;
    return c;
}
static FWPM_FILTER_CONDITION0 interfaceCondition(uint64_t *luid) {
    FWPM_FILTER_CONDITION0 c{};
    c.fieldKey = FWPM_CONDITION_IP_LOCAL_INTERFACE;
    c.matchType = FWP_MATCH_EQUAL;
    c.conditionValue.type = FWP_UINT64;
    c.conditionValue.uint64 = luid;
    return c;
}
static void addFilter(HANDLE engine, const GUID &layer, FWP_ACTION_TYPE action, UINT8 weight,
                      std::vector<FWPM_FILTER_CONDITION0> conditions, const wchar_t *name) {
    FWPM_FILTER0 filter{};
    filter.displayData.name = const_cast<wchar_t *>(name);
    filter.providerKey = const_cast<GUID *>(&Provider);
    filter.layerKey = layer;
    filter.subLayerKey = Sublayer;
    filter.flags = FWPM_FILTER_FLAG_PERSISTENT;
    filter.weight.type = FWP_UINT8;
    filter.weight.uint8 = weight;
    filter.action.type = action;
    filter.numFilterConditions = static_cast<UINT32>(conditions.size());
    filter.filterCondition = conditions.data();
    UINT64 id = 0;
    wincheck(FwpmFilterAdd0(engine, &filter, nullptr, &id), "Add WFP isolation filter");
}
Firewall::Firewall() {
    wincheck(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, nullptr, &engine),
             "Open WFP engine (administrator required)");
}
Firewall::~Firewall() {
    if (engine)
        FwpmEngineClose0(engine);
}
void Firewall::install(const std::wstring &executable, const Adapter *vpn) {
    FWPM_PROVIDER0 provider{};
    provider.providerKey = Provider;
    provider.displayData.name = const_cast<wchar_t *>(L"MyNEIGE PoC");
    provider.flags = FWPM_PROVIDER_FLAG_PERSISTENT;
    wincheck(FwpmTransactionBegin0(engine, 0), "Begin WFP transaction");
    try {
        DWORD code = FwpmProviderAdd0(engine, &provider, nullptr);
        require(code != FWP_E_ALREADY_EXISTS, "Stale MyNEIGE filters exist: run cleanup first");
        wincheck(code, "Create WFP provider");
        FWPM_SUBLAYER0 sublayer{};
        sublayer.subLayerKey = Sublayer;
        sublayer.providerKey = const_cast<GUID *>(&Provider);
        sublayer.displayData.name = const_cast<wchar_t *>(L"MyNEIGE PoC isolation");
        sublayer.flags = FWPM_SUBLAYER_FLAG_PERSISTENT;
        sublayer.weight = 65535;
        wincheck(FwpmSubLayerAdd0(engine, &sublayer, nullptr), "Create WFP sublayer");
        FWP_BYTE_BLOB *rawApp = nullptr;
        wincheck(FwpmGetAppIdFromFileName0(executable.c_str(), &rawApp), "Read relay WFP app ID");
        struct AppCleanup {
            FWP_BYTE_BLOB *p;
            ~AppCleanup() {
                FwpmFreeMemory0(reinterpret_cast<void **>(&p));
            }
        } app{rawApp};
        auto condition = appCondition(app.p);
        addFilter(engine, FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWP_ACTION_BLOCK, 1, {condition}, L"Relay IPv4 quarantine");
        addFilter(engine, FWPM_LAYER_ALE_AUTH_CONNECT_V6, FWP_ACTION_BLOCK, 1, {condition}, L"Relay IPv6 quarantine");
        if (vpn) {
            uint64_t luid = vpn->luid;
            auto iface = interfaceCondition(&luid);
            FWPM_FILTER_CONDITION0 source{};
            source.fieldKey = FWPM_CONDITION_IP_LOCAL_ADDRESS;
            source.matchType = FWP_MATCH_EQUAL;
            source.conditionValue.type = FWP_UINT32;
            source.conditionValue.uint32 = vpn->address;
            if (vpn->address)
                addFilter(engine, FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWP_ACTION_PERMIT, 15, {condition, iface, source},
                          L"Relay only through its VPN source/interface");
            addFilter(engine, FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWP_ACTION_BLOCK, 2, {iface},
                      L"Other processes denied on MyNEIGE tunnel IPv4");
            addFilter(engine, FWPM_LAYER_ALE_AUTH_CONNECT_V6, FWP_ACTION_BLOCK, 2, {iface},
                      L"All IPv6 denied on MyNEIGE tunnel");
        }
        wincheck(FwpmTransactionCommit0(engine), "Commit WFP policy");
        owns = true;
    } catch (...) {
        FwpmTransactionAbort0(engine);
        throw;
    }
}
void Firewall::allowVpn(const std::wstring &executable, const Adapter &vpn) {
    require(owns && vpn.address, "WFP quarantine must exist before authorizing the tunnel source");
    FWP_BYTE_BLOB *app = nullptr;
    wincheck(FwpmGetAppIdFromFileName0(executable.c_str(), &app), "Read isolated relay app ID");
    try {
        uint64_t luid = vpn.luid;
        auto source = FWPM_FILTER_CONDITION0{};
        source.fieldKey = FWPM_CONDITION_IP_LOCAL_ADDRESS;
        source.matchType = FWP_MATCH_EQUAL;
        source.conditionValue.type = FWP_UINT32;
        source.conditionValue.uint32 = vpn.address;
        addFilter(engine, FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWP_ACTION_PERMIT, 15,
                  {appCondition(app), interfaceCondition(&luid), source},
                  L"Relay authorized only on verified tunnel source");
    } catch (...) {
        FwpmFreeMemory0(reinterpret_cast<void **>(&app));
        throw;
    }
    FwpmFreeMemory0(reinterpret_cast<void **>(&app));
}
void Firewall::clear() {
    HANDLE enumeration = nullptr;
    // A zero actionMask matches no actions. Enumerate, then select our provider explicitly.
    wincheck(FwpmFilterCreateEnumHandle0(engine, nullptr, &enumeration),
             "Enumerate WFP filters for owned-provider cleanup");
    std::vector<GUID> keys;
    try {
        while (true) {
            FWPM_FILTER0 **filters = nullptr;
            UINT32 count = 0;
            wincheck(FwpmFilterEnum0(engine, enumeration, 64, &filters, &count), "Read MyNEIGE filters");
            for (UINT32 i = 0; i < count; ++i)
                if (filters[i]->providerKey && IsEqualGUID(*filters[i]->providerKey, Provider))
                    keys.push_back(filters[i]->filterKey);
            FwpmFreeMemory0(reinterpret_cast<void **>(&filters));
            if (!count)
                break;
        }
    } catch (...) {
        FwpmFilterDestroyEnumHandle0(engine, enumeration);
        throw;
    }
    FwpmFilterDestroyEnumHandle0(engine, enumeration);
    wincheck(FwpmTransactionBegin0(engine, 0), "Begin WFP cleanup");
    try {
        for (auto &key : keys)
            wincheck(FwpmFilterDeleteByKey0(engine, &key), "Delete owned WFP filter");
        DWORD code = FwpmSubLayerDeleteByKey0(engine, &Sublayer);
        if (code != FWP_E_SUBLAYER_NOT_FOUND)
            wincheck(code, "Delete owned WFP sublayer");
        code = FwpmProviderDeleteByKey0(engine, &Provider);
        if (code != FWP_E_PROVIDER_NOT_FOUND)
            wincheck(code, "Delete owned WFP provider");
        wincheck(FwpmTransactionCommit0(engine), "Commit WFP cleanup");
        owns = false;
    } catch (...) {
        FwpmTransactionAbort0(engine);
        throw;
    }
}
void Firewall::recover() {
    Firewall firewall;
    recoverStaging();
    firewall.clear();
}
void validateOpenVpn(const std::filesystem::path &executable) {
    require(std::filesystem::is_regular_file(executable),
            "OpenVPN executable missing; install official OpenVPN Community first");
    WINTRUST_FILE_INFO info{sizeof(info), executable.c_str(), nullptr, nullptr};
    WINTRUST_DATA trust{};
    trust.cbStruct = sizeof(trust);
    trust.dwUIChoice = WTD_UI_NONE;
    trust.fdwRevocationChecks = WTD_REVOKE_NONE;
    trust.dwUnionChoice = WTD_CHOICE_FILE;
    trust.pFile = &info;
    trust.dwStateAction = WTD_STATEACTION_VERIFY;
    trust.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;
    GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    LONG result = WinVerifyTrust(nullptr, &policy, &trust);
    bool publisher = false;
    if (result == ERROR_SUCCESS) {
        auto data = WTHelperProvDataFromStateData(trust.hWVTStateData);
        auto signer = data ? WTHelperGetProvSignerFromChain(data, 0, FALSE, 0) : nullptr;
        if (signer && signer->csCertChain) {
            auto certificate = signer->pasCertChain[0].pCert;
            DWORD count = CertGetNameStringW(certificate, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, nullptr, nullptr, 0);
            std::wstring subject(count, L'\0');
            CertGetNameStringW(certificate, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, nullptr, subject.data(), count);
            while (!subject.empty() && subject.back() == L'\0')
                subject.pop_back();
            publisher = subject == L"OpenVPN Inc." || subject == L"OpenVPN, Inc." || subject == L"OpenVPN Inc" ||
                        subject == L"OpenVPN Technologies, Inc.";
        }
    }
    trust.dwStateAction = WTD_STATEACTION_CLOSE;
    WinVerifyTrust(nullptr, &policy, &trust);
    require(result == ERROR_SUCCESS && publisher,
            "OpenVPN Authenticode signature/publisher could not be verified locally");
    DWORD ignored = 0;
    DWORD size = GetFileVersionInfoSizeW(executable.c_str(), &ignored);
    require(size > 0, "OpenVPN version resource missing");
    Bytes version(size);
    require(GetFileVersionInfoW(executable.c_str(), 0, size, version.data()) != 0, "Cannot read OpenVPN version");
    VS_FIXEDFILEINFO *fixed = nullptr;
    UINT fixedSize = 0;
    require(VerQueryValueW(version.data(), L"\\", reinterpret_cast<void **>(&fixed), &fixedSize) != 0 &&
                fixedSize >= sizeof(VS_FIXEDFILEINFO),
            "Invalid OpenVPN version metadata");
    require(HIWORD(fixed->dwFileVersionMS) == 2 && LOWORD(fixed->dwFileVersionMS) == 7 &&
                HIWORD(fixed->dwFileVersionLS) >= 8,
            "This pilot requires signed OpenVPN Community 2.7.8 or a later 2.7.x corrective release");
}
DWORD tcpOwner(const sockaddr_in &local, const sockaddr_in &remote) {
    ULONG size = 0;
    GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
    Bytes storage(size);
    wincheck(GetExtendedTcpTable(storage.data(), &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0),
             "Inspect management peer PID");
    auto table = reinterpret_cast<MIB_TCPTABLE_OWNER_PID *>(storage.data());
    for (DWORD i = 0; i < table->dwNumEntries; ++i) {
        auto &row = table->table[i];
        if (row.dwLocalAddr == remote.sin_addr.S_un.S_addr && row.dwLocalPort == remote.sin_port &&
            row.dwRemoteAddr == local.sin_addr.S_un.S_addr && row.dwRemotePort == local.sin_port &&
            row.dwState == MIB_TCP_STATE_ESTAB)
            return row.dwOwningPid;
    }
    return 0;
}
} // namespace neige
