"""Offline checks for patch packaging. Does not claim C# compilation or Emby compatibility."""
from pathlib import Path
from html.parser import HTMLParser
import subprocess
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "HomeScreenCompanion"

class HtmlIDs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.data_controller = []
    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if "id" in props: self.ids.append(props["id"])
        if "data-controller" in props: self.data_controller.append(props["data-controller"])

ET.parse(SRC / 'HomeScreenCompanion.csproj')
model = (SRC / 'PluginConfiguration.cs').read_text(encoding='utf-8')
plugin = (SRC / 'Plugin.cs').read_text(encoding='utf-8')
js = (SRC / 'Configuration/configPage.js').read_text(encoding='utf-8')
html = (SRC / 'Configuration/configPage.html').read_text(encoding='utf-8')
service = (SRC / 'HomeScreenCompanionService.cs').read_text(encoding='utf-8')
original_guid = '7c10708f-43e4-4d69-923c-77d01802315b'
new_guid = 'b5bca829-e903-4af4-9fb2-451d72a487e6'
assert original_guid not in plugin and original_guid not in js
assert new_guid in plugin and new_guid in js
assert 'HscAnimeEditionCollections' in (SRC / 'AnimeCollectionTask.cs').read_text(encoding='utf-8')
assert 'private const int BackupFormatVersion = 3' in service
for field in ('AnimeCollectionRulesJson', 'AnimeApprovedCollectionKeys', 'AnimeCollectionAliasesJson'):
    assert f'public string? {field}' in service or f'public string {field}' in service, field
    assert f'{field}   = config.{field}' in service or f'{field} = config.{field}' in service or f'{field} =' in service, 'export '+field
    assert f'if (s.{field} != null) config.{field}' in service, 'import '+field
assert 'DryRunMode' in (SRC / 'HomeSectionSyncTask.cs').read_text(encoding='utf-8')
assert 'foreach (var item in local.Where(i => i.AniListIds.Count == 0)' not in (SRC / 'AnimeAiAnalysisService.cs').read_text(encoding='utf-8')
assert 'kiwi4814/HSC-Anime-Edition/issues' in html
assert '"/HomeScreenCompanion/' not in service
assert "'HomeScreenCompanion/" not in js
checker = HtmlIDs(); checker.feed(html)
assert '__plugin/HomeScreenCompanionAnimeEditionJS' in checker.data_controller
controls = {
    'chkAnimeEnabled': 'AnimeEnabled',
    'chkAnimeDryRun': 'AnimeDryRun',
    'chkAnimeIncludeSpinOffs': 'AnimeIncludeSpinOffs',
    'chkAnimeAiOther': 'AnimeAiReviewOtherEdges',
    'selAnimeAiProvider': 'AnimeAiProvider',
    'txtAnimePrefix': 'AnimeCollectionPrefix',
    'txtAnimeApiBudget': 'AnimeMaxRequestsPerRun',
    'txtAnimeMappingUrl': 'AnimeMappingUrl',
    'txtCompatibleAiBaseUrl': 'CompatibleAiBaseUrl',
    'txtCompatibleAiModel': 'CompatibleAiModel',
    'txtCompatibleAiApiKey': 'CompatibleAiApiKey',
    'chkAnimeAiNaming': 'AnimeAiNamingEnabled',
    'chkAnimeAiCollectionReview': 'AnimeAiCollectionReviewEnabled',
    'txtAnimeAiMaxCalls': 'AnimeAiMaxCallsPerRun',
    'txtAnimeAiMaxTokensPerCall': 'AnimeAiMaxTokensPerCall',
    'txtAnimeAiMaxTokensPerRun': 'AnimeAiMaxTokensPerRun',
}
for element,field in controls.items():
    assert checker.ids.count(element) == 1,element
    assert f"#{element}" in js,element
    assert field in model,field
print(f'PASS: csproj XML, isolation GUID/routes, settings wiring ({len(controls)} fields)')
# These assertions are source-integration evidence, not runtime authentication/import/UI tests.
for route, verb, request in (
    ('/HomeScreenCompanionAnime/Ai/TestConnection', 'POST', 'TestAnimeAiConnectionRequest'),
    ('/HomeScreenCompanionAnime/Ai/Analysis', 'GET', 'GetAnimeAiAnalysisRequest'),
):
    pattern = (
        r'\[Route\("' + re.escape(route) + r'", "' + verb + r'"\)\]\s*'
        r'\[Authenticated\(Roles = "Admin"\)\]\s*public class ' + request + r'\b'
    )
    assert re.search(pattern, service), request
for field in ('CompatibleAiApiKey', 'OpenAiApiKey', 'GeminiApiKey', 'ClaudeApiKey',
              'TraktClientId', 'MdblistApiKey', 'TmdbApiKey'):
    assert f'AiSecretPolicy.ExportKey(config.{field})' in service, field
    assert f'AiSecretPolicy.PreserveImported(k.{field}, config.{field})' in service, field
assert 'AiSecretPolicy.PreserveMissing(config, saved)' in service
renderer = js.split('function loadAnimeAiAnalysis(view)', 1)[1].split('\n    function ', 1)[0]
assert 'textContent' in renderer and 'innerHTML' not in renderer
print('PASS: SOURCE ONLY admin-route attributes, backup secret-policy callsites, text-only analysis renderer')
try:
    subprocess.run(['node','--check',str(SRC / 'Configuration/configPage.js')],check=True,capture_output=True,text=True)
    print('PASS: Node.js JavaScript syntax check')
except FileNotFoundError:
    print('SKIP: Node.js not installed')
print('NOT_TESTED by this script: C# build/smoke, runtime authentication/backup HTTP, browser rendering, real AI providers or Emby runtime; consult separate logs')
