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
assert 'private const int BackupFormatVersion = 5' in service
for field in ('AnimeCollectionRulesJson', 'AnimeApprovedCollectionKeys', 'AnimeCollectionAliasesJson', 'AnimeDiscardedCollectionKeys'):
    assert f'public string? {field}' in service or f'public string {field}' in service or f'public string {field}' in model, field
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
    'chkAnimeScheduledWrite': 'AnimeDryRun',
    'chkAnimeIncludeSpinOffs': 'AnimeIncludeSpinOffs',
    'chkAnimeSkipWriteWhenReminders': 'AnimeSkipWriteWhenReminders',
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

assert 'data-page-tab="AnimeCollections"' in html
assert 'id="tabAnimeCollections"' in html
assert 'btnAnimeRunNow' in html and '#btnAnimeRunNow' in js
assert 'LastRunSummary' in service
task_cs = (SRC / 'AnimeCollectionTask.cs').read_text(encoding='utf-8')
assert 'last-run-summary.json' in task_cs
assert 'ReminderItems' in task_cs
assert 'class AnimeReminder' in task_cs
assert 'Reminders/Handled' in service
assert 'id="animeRemindersSection"' in html
assert 'anime-card-dot' in html
assert 'renderAnimeReminders' in js
assert 'HasReminder' in js
# Main anime path must not show jargon; advanced fold may keep support labels.
anime_tab = html.split('id="tabAnimeCollections"', 1)[1].split('id="tabCleanup"', 1)[0]
for banned in ('批准名单', '成员规则', 'Dry Run', 'Anchor', '连通分量', '赋能', '闭环', 'Provider', 'Token'):
    assert banned not in anime_tab, 'banned on anime tab: ' + banned
for banned in ('批准名单', '成员规则', 'Dry Run', '赋能', '闭环'):
    assert banned not in anime_tab
print('PASS: P0 anime studio tab + last-run summary wiring')
print('PASS: P1 reminders in last-run-summary + yellow-dot + reminders UI')

assert 'id="animeEditorPanel"' in html
assert 'txtAnimeEditorName' in html and '#txtAnimeEditorName' in js
assert 'btnAnimeEditorSave' in html and 'saveAnimeCollectionEditor' in js
assert 'btnAnimeEditorAuto' in html and 'clearAnimeCollectionEditorRule' in js
assert 'openAnimeCollectionEditor' in js
assert 'CollectionEditor/Save' in service
assert 'CollectionEditor/ClearRule' in service
assert 'Anime/MediaSearch' in service
assert 'AnimeCollectionEditorSupport' in (SRC / 'AnimeCollectionEditorSupport.cs').read_text(encoding='utf-8')
assert '改回自动归类' in html
# Editor panel must stay jargon-free on the main path.
editor = html.split('id="animeEditorPanel"', 1)[1].split('id="tabCleanup"', 1)[0]
for banned in ('批准名单', '成员规则', 'Key', 'Anchor', 'JSON', 'Dry Run', 'Provider', 'Token', '赋能', '闭环'):
    assert banned not in editor, 'banned on editor panel: ' + banned
# 去处理 must open editor, not only highlight.
assert 'focusAnimeReminderTarget' in js
assert 'openAnimeCollectionEditor(view' in js.split('function focusAnimeReminderTarget', 1)[1].split('function ', 1)[0]
print('PASS: P2 collection visual editor wiring')

# Relation-graph UI removed; backend GraphSupport deleted with CollectionGraph API.
assert 'id="animeEditorGraphSection"' not in html
assert 'animeGraphSvg' not in html
assert 'loadAnimeCollectionGraph' not in js
assert '关系图' not in html and '关系图' not in js
assert 'CollectionGraph' not in service
assert not (SRC / 'AnimeCollectionGraphSupport.cs').exists()
assert 'id="animeConfirmOverlay"' in html
assert 'btnAnimeConfirmCreate' in html and '一键创建' in html
assert 'openAnimeConfirmPanel' in js and 'submitAnimeConfirmCreate' in js
assert 'Anime/ManualPreview' in service
assert 'Anime/Discard' in service
assert 'Anime/ConfirmCreate' in service
assert 'AnimeDiscardedCollectionKeys' in model
assert 'chkAnimeScheduledWrite' in html and '定时自动写入' in html
anime_tab = html.split('id="tabAnimeCollections"', 1)[1].split('id="tabCleanup"', 1)[0]
assert 'animeSyncModeWrite' not in anime_tab and 'animeSyncModePreview' not in anime_tab
assert 'id="lblAnimeSyncWrite"' not in anime_tab
assert '定时自动写入' in anime_tab
# Confirm panel jargon-free
confirm = html.split('id="animeConfirmOverlay"', 1)[1].split('id="tabCleanup"', 1)[0] if 'id="tabCleanup"' in html.split('id="animeConfirmOverlay"', 1)[1] else html.split('id="animeConfirmOverlay"', 1)[1]
# overlay is after tabs; just check overlay chunk
confirm = html.split('id="animeConfirmOverlay"', 1)[1]
for banned in ('批准名单', '成员规则', 'Key', 'Anchor', 'JSON', 'Dry Run', 'Provider', 'Token', '赋能', '闭环', '关系图'):
    assert banned not in confirm, 'banned on confirm overlay: ' + banned
# Editor still present without graph
assert 'id="animeEditorPanel"' in html
assert 'openAnimeCollectionEditor' in js
assert 'saveAnimeCollectionEditor' in js
print('PASS: preview-confirm panel + graph UI removed; editor kept')

assert 'AnimeSkipWriteWhenReminders' in model
assert 'chkAnimeSkipWriteWhenReminders' in html and '#chkAnimeSkipWriteWhenReminders' in js
assert 'Reminders/AdoptName' in service
assert 'adoptAnimeSuggestedName' in js
assert '采用建议显示名' in js
assert 'SuggestedName' in (SRC / 'AnimeCollectionTask.cs').read_text(encoding='utf-8')
assert '按设置：有提醒的合集先不写入' in (SRC / 'AnimeCollectionTask.cs').read_text(encoding='utf-8')
assert 'AnimeReminders' in service and "key: 'AnimeReminders'" in js
# Compatible AI inputs live under AI settings, not the anime studio main tab.
assert 'txtCompatibleAiBaseUrl' in html
anime_tab = html.split('id="tabAnimeCollections"', 1)[1].split('id="tabCleanup"', 1)[0]
assert 'txtCompatibleAiBaseUrl' not in anime_tab
assert 'txtCompatibleAiApiKey' not in anime_tab
# Anime settings panel must not re-host Compatible credential inputs.
anime_settings_start = html.find('id="animeSettingsPanel"')
ai_settings_title = html.find('AI 设置</span>', anime_settings_start)
assert anime_settings_start >= 0 and ai_settings_title > anime_settings_start
anime_settings = html[anime_settings_start:ai_settings_title]
assert 'txtCompatibleAiBaseUrl' not in anime_settings
assert 'compatibleAiFields' in html[ai_settings_title:]
assert '不配也能自动分组' in html
print('PASS: P4 skip-write / adopt-name / backup reminders / Compatible AI under AI settings')



print('NOT_TESTED by this script: C# build/smoke, runtime authentication/backup HTTP, browser rendering, real AI providers or Emby runtime; consult separate logs')
