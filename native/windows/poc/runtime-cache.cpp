#include "startup.hpp"
#include "session.hpp"

namespace neige {
static void linkRuntime(const std::filesystem::path &cache, const std::filesystem::path &destination) {
    require(std::filesystem::create_directory(destination), "Cannot create owned runtime directory");
    grantUserRead(destination);
    for (const auto &entry : std::filesystem::directory_iterator(cache)) {
        if (entry.is_directory()) linkRuntime(entry.path(), destination / entry.path().filename());
        else {
            auto target = destination / entry.path().filename();
            // Both paths are on ProgramData's volume. Each session keeps its own WFP image path.
            require(CreateHardLinkW(target.c_str(), entry.path().c_str(), nullptr) != 0,
                    "Cannot link protected runtime into session");
        }
    }
}
void prepareRuntime(const std::filesystem::path &source, const std::filesystem::path &destination,
                    const std::filesystem::path &protectedRoot) {
    const auto started = GetTickCount64();
    // In a distribution the launcher already verifies all source hashes. Verify cached bytes against
    // that manifest directly, rather than reading the entire source runtime a second time.
    auto files = runtimeManifest(source);
    std::vector<std::filesystem::path> directories;
    if (files.empty()) {
        assertPlainTree(source);
        for (const auto &entry : std::filesystem::recursive_directory_iterator(source)) {
            auto relative = entry.path().lexically_relative(source);
            if (entry.is_directory()) directories.push_back(relative);
            else files.push_back({relative, sha256File(entry.path())});
        }
    } else {
        std::set<std::filesystem::path> parents;
        for (const auto &file : files)
            for (auto parent = file.relative.parent_path(); !parent.empty(); parent = parent.parent_path())
                parents.insert(parent);
        directories.assign(parents.begin(), parents.end());
    }
    std::sort(files.begin(), files.end(), [](const auto &a, const auto &b) { return a.relative < b.relative; });
    std::sort(directories.begin(), directories.end());
    std::string identity = "MyNEIGE runtime cache v1\n" + utf8(currentUserSid()) + "\n";
    for (const auto &dir : directories) identity += "D " + utf8(dir.generic_wstring()) + "\n";
    for (const auto &file : files) identity += "F " + utf8(file.relative.generic_wstring()) + " " + file.hash + "\n";
    auto key = sha256Text(identity);
    auto cache = protectedRoot / wide("cache-" + lower(key));
    createProtectedDirectory(cache);
    auto browser = cache / L"browser";
    auto runtime = browser / L"runtime";
    bool reused = std::filesystem::is_regular_file(cache / L"complete.txt");
    if (!reused) {
        // An interrupted build has no completion marker. Only our protected subtree is removed.
        removeProtectedTree(browser, cache);
        createProtectedDirectory(browser);
        grantUserRead(browser);
        createProtectedDirectory(runtime);
        grantUserRead(runtime);
        for (const auto &dir : directories) {
            createProtectedDirectory(runtime / dir);
            grantUserRead(runtime / dir);
        }
        for (const auto &file : files) {
            auto target = runtime / file.relative;
            require(CopyFileW((source / file.relative).c_str(), target.c_str(), TRUE) != 0,
                    "Cannot populate protected runtime cache");
            grantUserRead(target);
        }
    }
    // Never trust a timestamp, version string or writable cache. Verify every cached byte and ACL.
    assertPlainTree(cache);
    verifyProtectedDirectory(cache);
    verifyProtectedDirectory(browser);
    verifyProtectedDirectory(runtime);
    size_t found = 0;
    for (const auto &entry : std::filesystem::recursive_directory_iterator(runtime)) {
        verifyProtectedDirectory(entry.path());
        if (!entry.is_directory()) ++found;
    }
    require(found == files.size(), "Unexpected files in protected runtime cache");
    for (const auto &file : files)
        require(sha256File(runtime / file.relative) == file.hash, "Protected runtime cache integrity failure");
    if (!reused) {
        std::ofstream complete(cache / L"complete.txt", std::ios::binary);
        require(bool(complete << key << "\n"), "Cannot commit runtime cache");
    }
    linkRuntime(runtime, destination);
    std::cout << "STARTUP_RUNTIME cache=" << (reused ? "reused" : "created") << " files=" << files.size()
              << " elapsed_ms=" << GetTickCount64() - started << std::endl;
}
static bool sameFile(const std::filesystem::path &a, const std::filesystem::path &b) {
    Handle first(CreateFileW(a.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                             nullptr, OPEN_EXISTING, 0, nullptr));
    Handle second(CreateFileW(b.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              nullptr, OPEN_EXISTING, 0, nullptr));
    BY_HANDLE_FILE_INFORMATION one{}, two{};
    require(GetFileInformationByHandle(first.h, &one) && GetFileInformationByHandle(second.h, &two),
            "Cannot compare runtime file identities");
    return one.dwVolumeSerialNumber == two.dwVolumeSerialNumber && one.nFileIndexHigh == two.nFileIndexHigh &&
           one.nFileIndexLow == two.nFileIndexLow;
}
int runtimeCacheTest(const std::filesystem::path &projectRoot) {
    require(isAdministrator(), "runtime-cache-test requires elevation");
    auto mutex = sessionMutex();
    Staging staging;
    staging.allowUserRead();
    auto browser = staging.directory / L"browser";
    createProtectedDirectory(browser);
    grantUserRead(browser);
    auto source = browser / L"fixture";
    auto caches = browser / L"fixture-caches";
    createProtectedDirectory(source);
    grantUserRead(source);
    createProtectedDirectory(caches);
    auto writeFixture = [&](const std::filesystem::path &path, const char *text) {
        std::ofstream file(path, std::ios::binary | std::ios::trunc);
        require(bool(file << text), "Cannot write runtime fixture");
        file.close();
        grantUserRead(path);
    };
    writeFixture(source / L"electron.exe", "abc");
    prepareRuntime(source, browser / L"one", caches);
    prepareRuntime(source, browser / L"two", caches);
    auto one = browser / L"one/electron.exe", two = browser / L"two/electron.exe";
    require(sameFile(one, two), "Second session copied runtime bytes instead of linking");
    require(!sameFile(one, source / L"electron.exe"), "Cache is hard-linked to writable source");
    Job job;
    auto child = job.spawn(staging.diagnostic().wstring(), {L"runtime-cache-probe", two.wstring()}, true, true);
    require(child.line(10000) == "CACHE_READ_ONLY", "Cached runtime is not read-only for the browser token");
    child.stop();
    writeFixture(source / L"electron.exe", "new-version");
    prepareRuntime(source, browser / L"three", caches);
    auto three = browser / L"three/electron.exe";
    require(!sameFile(one, three) && sha256File(one) == sha256Text("abc"),
            "Runtime update reused or modified the old cache");
    writeFixture(three, "corrupted");
    bool refused = false;
    try { prepareRuntime(source, browser / L"four", caches); }
    catch (const std::exception &) { refused = true; }
    require(refused && !std::filesystem::exists(browser / L"four"), "Tampered runtime cache accepted");
    // Exercise interrupted population: no marker means rebuild, never reuse partial bytes.
    for (const auto &entry : std::filesystem::directory_iterator(caches))
        if (sameFile(entry.path() / L"browser/runtime/electron.exe", three))
            require(DeleteFileW((entry.path() / L"complete.txt").c_str()), "Cannot simulate interrupted cache");
    prepareRuntime(source, browser / L"recovered", caches);
    require(sha256File(browser / L"recovered/electron.exe") == sha256Text("new-version"),
            "Incomplete runtime cache did not recover");
    auto aclFixture = browser / L"cleanup-acl";
    createProtectedDirectory(aclFixture);
    auto setFixtureAcl = [&](const wchar_t *sddl) {
        PSECURITY_DESCRIPTOR descriptor = nullptr;
        require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, nullptr),
                "Cannot construct cache cleanup ACL fixture");
        std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
        require(SetFileSecurityW(aclFixture.c_str(), OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                    PROTECTED_DACL_SECURITY_INFORMATION, descriptor), "Cannot set cache cleanup ACL fixture");
    };
    setFixtureAcl(L"O:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;WD)");
    verifyProtectedDirectory(aclFixture, true);
    setFixtureAcl(L"O:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;WD)");
    bool writeAclRefused = false;
    try { verifyProtectedDirectory(aclFixture, true); }
    catch (const std::exception &) { writeAclRefused = true; }
    grantUserRead(aclFixture);
    require(writeAclRefused, "Administrative cache cleanup accepted a user-writable ACL");
    auto runtime = projectRoot / L"resources/runtime";
    if (!std::filesystem::exists(runtime)) runtime = projectRoot / L"node_modules/electron/dist";
    const auto copyStarted = GetTickCount64();
    std::function<void(const std::filesystem::path &, const std::filesystem::path &)> legacyCopy;
    legacyCopy = [&](const auto &from, const auto &to) {
        DWORD attributes = GetFileAttributesW(from.c_str());
        require(attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_REPARSE_POINT),
                "Invalid runtime copy source");
        if (attributes & FILE_ATTRIBUTE_DIRECTORY) {
            require(std::filesystem::create_directory(to), "Cannot create copy benchmark directory");
            grantUserRead(to);
            for (const auto &entry : std::filesystem::directory_iterator(from))
                legacyCopy(entry.path(), to / entry.path().filename());
        } else {
            require(CopyFileW(from.c_str(), to.c_str(), TRUE), "Cannot copy runtime benchmark file");
            grantUserRead(to);
        }
    };
    legacyCopy(runtime, browser / L"legacy-copy");
    std::cout << "STARTUP_RUNTIME legacy_copy_ms=" << GetTickCount64() - copyStarted << std::endl;
    // Both measured sessions use the real Electron tree; no Electron/VPN/WFP process is started.
    prepareRuntime(runtime, browser / L"real-one", staging.directory.parent_path());
    prepareRuntime(runtime, browser / L"real-two", staging.directory.parent_path());
    require(sameFile(browser / L"real-one/electron.exe", browser / L"real-two/electron.exe"),
            "Real Electron runtime was not reused");
    std::cout << "RUNTIME_CACHE_TEST reuse=true source_isolated=true read_only=true update=true tamper_refused=true "
                 "interrupted_recovered=true cleanup_acl=true real_runtime=true vpn=false wfp=false" << std::endl;
    return 0;
}
} // namespace neige
