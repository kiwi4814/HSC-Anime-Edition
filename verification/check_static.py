"""Offline checks for patch packaging. Does not claim C# compilation or Emby compatibility."""
from pathlib import Path
from html.parser import HTMLParser
import subprocess
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
assert 'RunAutoMigration(); // upstream-only operation intentionally disabled' in (SRC / 'ServerEntryPoint.cs').read_text(encoding='utf-8')
assert 'private const int BackupFormatVersion = 3' in service
assert '"/HomeScreenCompanion/' not in service
assert "'HomeScreenCompanion/" not in js
assert 'new Guid(' in plugin
assert '<EmbyReferenceDir Condition=' in (SRC / 'HomeScreenCompanion.csproj').read_text(encoding='utf-8')
assert 'InjectVersionIntoHtml' not in (SRC / 'HomeScreenCompanion.csproj').read_text(encoding='utf-8')
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
}
for element,field in controls.items():
    assert checker.ids.count(element) == 1,element
    assert f"#{element}" in js,element
    assert field in model,field
assert 'AnimeCollectionTask.cs' in (ROOT / 'OMP_LOCAL_HANDOFF.md').read_text(encoding='utf-8') or (SRC/'AnimeCollectionTask.cs').exists()
assert (ROOT / 'LICENSE').exists()
assert (SRC / 'AnimeMappingIndex.cs').exists()
assert (SRC / 'AnimeRelations.cs').exists()
assert (SRC / 'AnimeAniListClient.cs').exists()
print(f'PASS: csproj XML, isolation GUID/routes, settings wiring ({len(controls)} fields), license and module presence')
try:
    subprocess.run(['node','--check',str(SRC / 'Configuration/configPage.js')],check=True,capture_output=True,text=True)
    print('PASS: Node.js JavaScript syntax check')
except FileNotFoundError:
    print('SKIP: Node.js not installed')
print('NOT_TESTED by this script: C# build, smoke execution and Emby runtime; consult their separate logs')
