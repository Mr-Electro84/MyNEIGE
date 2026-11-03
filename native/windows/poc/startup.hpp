#pragma once
#include "platform.hpp"
#include "../shared/hash.hpp"
namespace neige {
void assertPlainTree(const std::filesystem::path &root);
void validateDistribution(const std::filesystem::path &root);
struct RuntimeFile {
    std::filesystem::path relative;
    std::string hash;
};
std::vector<RuntimeFile> runtimeManifest(const std::filesystem::path &source);
void prepareRuntime(const std::filesystem::path &source, const std::filesystem::path &destination,
                    const std::filesystem::path &protectedRoot);
void openDistributionLog(const std::string &name);
int runtimeCacheTest(const std::filesystem::path &projectRoot);
int runtimeCacheProbe(const std::filesystem::path &path);
} // namespace neige
