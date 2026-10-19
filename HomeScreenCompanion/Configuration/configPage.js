define(['emby-input', 'emby-button', 'emby-select', 'emby-checkbox'], function () {
    'use strict';

    var pluginId = "b5bca829-e903-4af4-9fb2-451d72a487e6";
    var statusInterval = null;
    // Live log modal: latest status per task and the tab the user picked (null = automatic)
    var _lastStatus = { sync: null, hsc: null, tl: null };
    var _logTab = null;
    var originalConfigState = null;
    var statusRequestId = 0;

    var DEFAULT_AI_SYSTEM_PROMPT = '你是影视推荐助手。只返回有效的 JSON 数组，不要解释、Markdown 或代码围栏。每项必须包含："title"（字符串，必填）、"year"（整数或 null）、"imdb_id"（已知时为以 "tt" 开头的字符串，否则为 null）、"type"（"movie" 或 "show"）。仅返回用户要求的条目，不要附加说明。示例：[{"title":"虚构示例影片","year":2020,"imdb_id":null,"type":"movie"}]';

    function updateSystemPromptResetBtn(view) {
        var ta = view.querySelector('#txtAiSystemPrompt');
        var btn = view.querySelector('#btnResetAiSystemPrompt');
        if (!ta || !btn) return;
        btn.style.display = ta.value.trim() !== DEFAULT_AI_SYSTEM_PROMPT.trim() ? '' : 'none';
    }

    function applyPluginTheme() {
        var candidates = ['.skinHeader', '.mainDrawer', '.contentScrollSlider', 'body'];
        var bg = null;
        for (var i = 0; i < candidates.length; i++) {
            var el = document.querySelector(candidates[i]);
            if (!el) continue;
            var c = getComputedStyle(el).backgroundColor;
            if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') { bg = c; break; }
        }
        var isDark = true;
        if (bg) {
            var m = bg.match(/\d+/g);
            if (m) isDark = (parseInt(m[0]) * 0.299 + parseInt(m[1]) * 0.587 + parseInt(m[2]) * 0.114) < 128;
        }
        var root = document.documentElement;
        if (isDark) {
            root.style.setProperty('--plugin-popup-bg',     '#2a2a2a');
            root.style.setProperty('--plugin-popup-bg2',    '#333333');
            root.style.setProperty('--plugin-popup-color',  '#e8e8e8');
            root.style.setProperty('--plugin-popup-muted',  '#aaaaaa');
            root.style.setProperty('--plugin-popup-border', 'rgba(255,255,255,0.12)');
            root.style.setProperty('--plugin-popup-hover',  'rgba(255,255,255,0.08)');
            root.style.setProperty('--plugin-popup-badge',  'rgba(255,255,255,0.1)');
            root.style.setProperty('--plugin-input-border', 'rgba(255,255,255,0.2)');
            root.style.setProperty('--plugin-input-bg',     'rgba(255,255,255,0.08)');
            root.style.setProperty('--plugin-footer-bg',    '#181818');
            root.dataset.pluginTheme = 'dark';
        } else {
            root.style.setProperty('--plugin-popup-bg',     '#f2f2f2');
            root.style.setProperty('--plugin-popup-bg2',    '#e0e0e0');
            root.style.setProperty('--plugin-popup-color',  '#1a1a1a');
            root.style.setProperty('--plugin-popup-muted',  '#555555');
            root.style.setProperty('--plugin-popup-border', 'rgba(0,0,0,0.15)');
            root.style.setProperty('--plugin-popup-hover',  'rgba(0,0,0,0.08)');
            root.style.setProperty('--plugin-popup-badge',  'rgba(0,0,0,0.1)');
            root.style.setProperty('--plugin-input-border', 'rgba(0,0,0,0.28)');
            root.style.setProperty('--plugin-input-bg',     'rgba(0,0,0,0.04)');
            root.style.setProperty('--plugin-footer-bg',    '#c5cad1');
            root.dataset.pluginTheme = 'light';
        }
        var drawer = document.querySelector('.mainDrawer');
        var drawerRight = drawer ? drawer.getBoundingClientRect().right : 0;
        var footerLeft = (drawerRight > 0 && drawerRight < window.innerWidth * 0.5) ? drawerRight : 0;
        root.style.setProperty('--plugin-footer-left', footerLeft + 'px');
    }

    var cachedCollections = [];
    var cachedPlaylists = [];
    var cachedTags = [];
    var lastHscConfig = {};
    var currentManageSections = [];
    var savedFilters = [];
    var _topListTagNames = new Set();

    var customCss = `
    <style id="homeScreenCompanionCustomCss">
        .day-toggle {
            background: rgba(128,128,128,0.08);
            color: var(--theme-text-secondary);
            border: 1px solid var(--line-color);
            border-radius: 4px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
            text-transform: uppercase;
            font-weight: bold;
            flex-grow: 1;
            text-align: center;
        }
        .day-toggle:hover {
            background: var(--theme-background-level2);
            color: var(--theme-text-primary);
            border-color: var(--theme-primary-color);
        }
        .day-toggle.active {
            background: #52B54B;
            color: #fff;
            border-color: #52B54B;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        }

        .date-row-container {
            background: rgba(128,128,128,0.06);
            border: 1px solid var(--line-color);
            border-radius: 6px;
            padding: 15px;
            margin-bottom: 10px;
        }

        .selectLabel {
            font-size: 0.9em;
            color: var(--theme-text-secondary);
            margin-bottom: 5px;
            font-weight: 500;
            display: block;
        }

        .tag-indicator {
            margin-left: 10px;
            font-size: 0.75em;
            padding: 2px 8px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            gap: 4px;
            font-weight: 500;
            position: relative;
        }

        .tag-indicator.schedule {
            color: #00a4dc;
            background: rgba(0,164,220,0.15);
            border: 1px solid rgba(0,164,220,0.35);
        }

        .tag-indicator.collection {
            color: #8459ca;
            background: rgba(126, 77, 172, 0.15);
            border: 1px solid rgba(126, 77, 172, 0.35);
        }

        .tag-indicator.homescreen {
            color: #4CAF50;
            background: rgba(76,175,80,0.15);
            border: 1px solid rgba(76,175,80,0.35);
        }

        .tag-indicator.schedule::after {
            content: '';
            position: absolute;
            top: -3px;
            right: -3px;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #f59e0b;
            box-shadow: 0 0 0 1.5px var(--theme-background, #101010);
        }

        .tag-indicator.schedule.schedule-active::after {
            background: #52B54B;
        }

        .tag-indicator.tag {
            color: #909090;
            background: rgba(80,80,80,0.18);
            border: 1px solid rgba(80,80,80,0.35);
        }

        .tag-indicator.playlist {
            color: #2db396;
            background: rgba(45, 184, 154, 0.15);
            border: 1px solid rgba(43, 190, 154, 0.35);
        }

        .tag-indicator.toplist {
            color: #c9a84c;
            background: rgba(180,140,50,0.15);
            border: 1px solid rgba(180,140,50,0.4);
        }

        .tag-indicator.ct-movies {
            color: #a8927c;
            background: rgba(168,146,124,0.10);
            border: 1px solid rgba(168,146,124,0.28);
        }

        .tag-indicator.ct-shows {
            color: #8f8aa8;
            background: rgba(143,138,168,0.10);
            border: 1px solid rgba(143,138,168,0.28);
        }

        .tag-indicator.source {
            color: #78909c;
            background: rgba(120,144,156,0.15);
            border: 1px solid rgba(120,144,156,0.35);
            padding: 2px 5px;
            margin-left: 0;
            margin-right: 8px;
        }

        .badge-container {
            display: flex;
            align-items: center;
        }

        .sort-hidden .drag-handle {
            display: none !important;
        }

        .dry-run-warning {
            background-color: #E67E22;
            color: #000000;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            text-align: center;
            font-weight: bold;
            font-size: 1.1em;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            display: none;
            align-items: center;
            justify-content: center;
            gap: 10px;
            position: sticky;
            top: 60px;
            z-index: 10000;
        }

        .drag-handle {
            cursor: grab;
            margin-right: 15px;
            color: var(--theme-text-secondary);
            display: flex;
            align-items: center;
        }

        .drag-handle:active {
            cursor: grabbing;
        }

        .tag-row {
            position: relative;
            background: var(--theme-background-level2);
            margin-bottom: 15px;
            border-radius: 6px;
            border: 1px solid var(--line-color);
            border-left: 5px solid #52B54B;
            transition: all 0.2s ease;
            box-shadow: 0 2px 6px rgba(0,0,0,0.12);
            overflow: hidden;
        }

        .tag-row.inactive {
            border-left-color: rgba(128,128,128,0.5);
        }

        .tag-row.dragging {
            opacity: 0.4 !important;
            border: 2px dashed #999 !important;
            background: var(--theme-background-level1) !important;
        }

        .sort-placeholder {
            height: 40px;
            background-color: transparent;
            margin-bottom: 15px;
            border-radius: 6px;
            border: 2px dashed var(--line-color);
            transition: height 0.2s;
        }

        .tag-row.just-moved {
            animation: moveHighlight 2s ease-out forwards;
        }

        .tag-row.just-added {
            animation: addHighlight 2s ease-out forwards;
        }

        @keyframes moveHighlight {
            0% {
                border-top: 1px solid #00a4dc;
                border-right: 1px solid #00a4dc;
                border-bottom: 1px solid #00a4dc;
                box-shadow: 0 0 15px rgba(0,164,220,0.5);
            }
            100% {
                border-top: 1px solid var(--line-color);
                border-right: 1px solid var(--line-color);
                border-bottom: 1px solid var(--line-color);
                box-shadow: 0 2px 6px rgba(0,0,0,0.12);
            }
        }

        @keyframes tcDotBounce {
            0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
            40%            { transform: translateY(-5px); opacity: 1; }
        }
        .tc-dot-loader { display:inline-flex; align-items:center; gap:5px; }
        .tc-dot-loader span { display:inline-block; width:7px; height:7px; border-radius:50%; background:currentColor; animation:tcDotBounce 1.2s ease-in-out infinite; }
        .tc-dot-loader span:nth-child(2) { animation-delay:0.2s; }
        .tc-dot-loader span:nth-child(3) { animation-delay:0.4s; }

        @keyframes addHighlight {
            0% {
                border-top: 1px solid #52B54B;
                border-right: 1px solid #52B54B;
                border-bottom: 1px solid #52B54B;
                box-shadow: 0 0 15px rgba(82,181,75,0.5);
            }
            100% {
                border-top: 1px solid var(--line-color);
                border-right: 1px solid var(--line-color);
                border-bottom: 1px solid var(--line-color);
                box-shadow: 0 2px 6px rgba(0,0,0,0.12);
            }
        }

        .control-row {
            background: rgba(128,128,128,0.06);
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid var(--line-color);
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .control-sub-row {
            display: flex;
            align-items: center;
            gap: 20px;
        }

        .control-group {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .control-label {
            font-size: 0.85em;
            opacity: 0.5;
            text-transform: uppercase;
            font-weight: bold;
            letter-spacing: 0.5px;
        }

        .search-input-wrapper {
            position: relative;
            display: flex;
            align-items: center;
            flex-grow: 1;
            max-width: 250px;
        }

        .search-input-wrapper .search-icon {
            position: absolute;
            left: 10px;
            font-size: 1em;
            opacity: 0.5;
            pointer-events: none;
        }

        #btnClearSearch {
            position: absolute;
            right: 8px;
            cursor: pointer;
            opacity: 0.5;
            display: none;
        }

        #btnClearSearch:hover {
            opacity: 1;
            color: #cc3333;
        }

        #txtSearchTags {
            width: 100%;
            background: rgba(128,128,128,0.06) !important;
            border: 1px solid var(--line-color) !important;
            border-radius: 4px !important;
            padding: 6px 30px 6px 35px !important;
            color: inherit;
            font-size: 0.95em;
        }

        #txtSearchTags:focus {
            border-color: var(--theme-primary-color) !important;
            background: rgba(128,128,128,0.1) !important;
        }

        .filter-dropdown-wrapper {
            position: relative;
            flex-shrink: 0;
        }

        .filter-dropdown-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            background: var(--plugin-input-bg, rgba(128,128,128,0.08));
            border: 1px solid var(--plugin-input-border, var(--line-color));
            border-radius: 4px;
            font-size: 0.9em;
            cursor: pointer;
            color: var(--plugin-popup-color, inherit);
            white-space: nowrap;
            user-select: none;
        }

        .filter-dropdown-btn:hover {
            background: var(--plugin-popup-hover, rgba(128,128,128,0.15));
        }

        html[data-plugin-theme="dark"] select,
        html[data-plugin-theme="dark"] input[type="text"],
        html[data-plugin-theme="dark"] input[type="number"] {
            color-scheme: dark;
        }

        html[data-plugin-theme="light"] select,
        html[data-plugin-theme="light"] input[type="text"],
        html[data-plugin-theme="light"] input[type="number"] {
            color-scheme: light;
        }

        .filter-dropdown-btn.active {
            border-color: #52B54B;
            color: #52B54B;
        }

        .filter-dropdown-panel {
            display: none;
            position: absolute;
            top: calc(100% + 6px);
            left: 0;
            z-index: 9999;
            background: var(--plugin-popup-bg, #2a2a2a);
            color: var(--plugin-popup-color, #e8e8e8);
            border: 1px solid var(--plugin-popup-border, rgba(255,255,255,0.12));
            border-radius: 6px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            padding: 10px 14px;
            min-width: 200px;
        }

        .filter-dropdown-panel.open {
            display: block;
        }

        .hsc-user-dropdown .filter-dropdown-panel {
            max-height: 260px;
            overflow-y: auto;
        }

        .filter-dropdown-section {
            margin-bottom: 10px;
        }

        .filter-dropdown-section:last-child {
            margin-bottom: 0;
        }

        .filter-dropdown-divider {
            height: 1px;
            background: var(--line-color);
            margin: 8px 0;
        }

        .filter-dropdown-label {
            font-size: 0.75em;
            opacity: 0.5;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 6px;
        }

        .filter-chk-row {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 3px 0;
            cursor: pointer;
            font-size: 0.9em;
        }

        .filter-chk-row input[type=checkbox] {
            cursor: pointer;
        }

        .btn-row-remove {
            background: transparent !important;
            min-width: 40px;
            width: 40px;
            padding: 0;
            color: #cc3333;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: none;
            margin-top: 12px;
        }

        .btn-neutral {
            background: var(--theme-background-level2) !important;
            border: 1px solid rgba(128,128,128,0.4) !important;
            color: var(--theme-text-primary) !important;
        }
        .plugin-footer {
            position: fixed;
            bottom: 0;
            left: var(--plugin-footer-left, 0);
            right: 0;
            z-index: 200;
            background: var(--plugin-footer-bg);
            color: var(--plugin-popup-muted);
            height: 50px;
            padding: 0 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.9em;
            border-top: 1px solid var(--line-color);
            box-sizing: border-box;
        }
        .plugin-footer .footer-version {
            color: var(--theme-text-secondary);
        }
        .plugin-footer .footer-sep {
            margin: 0 12px;
            opacity: 0.35;
        }
        .plugin-footer .footer-update-link {
            color: #E67E22;
            text-decoration: none;
            font-weight: bold;
        }
        .plugin-footer .simple-link {
            font-size: 1em;
            transition: none;
            transform: none;
        }
        .plugin-footer .simple-link:hover {
            transform: none;
        }
    </style>`;

    function getUrlRowHtml(value, limit) {
        var val = value || '';
        var lim = limit !== undefined ? limit : 0;
        return `
            <div class="url-row" style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                <div style="flex-grow:1;">
                    <input is="emby-input" class="txtTagUrl" type="text" label="Trakt/MDBList/TMDb 地址" value="${val}" />
                </div>
                <div style="width:110px;">
                    <input is="emby-input" class="txtUrlLimit" type="number" label="上限（0=全部）" value="${lim}" min="0" />
                </div>
                <button type="button" is="emby-button" class="raised button-submit btnTestUrl" style="min-width:60px; height:36px; padding:0 10px; font-size:0.8rem; margin-top:12px;" title="测试来源"><span>测试</span></button>
                <button type="button" is="emby-button" class="raised btnRemoveUrl btn-row-remove" title="移除地址"><i class="md-icon">remove_circle_outline</i></button>
            </div>`;
    }

    function getLocalRowHtml(type, selectedName, limit) {
        var options = type === 'LocalCollection' ? cachedCollections : cachedPlaylists;
        var optHtml = '<option value="">-- 请选择 --</option>' + options.map(o => `<option value="${o.Name}" ${selectedName === o.Name ? 'selected' : ''}>${o.Name}</option>`).join('');
        var lim = limit !== undefined ? limit : 0;
        return `
            <div class="local-row" style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                <div style="flex-grow:1;">
                    <select is="emby-select" class="selLocalSource" style="width:100%;">
                        ${optHtml}
                    </select>
                </div>
                <div style="width:110px;">
                    <input is="emby-input" class="txtLocalLimit" type="number" label="上限（0=全部）" value="${lim}" min="0" />
                </div>
                <button type="button" is="emby-button" class="raised btnRemoveLocal btn-row-remove" title="移除"><i class="md-icon">remove_circle_outline</i></button>
            </div>`;
    }

    function getMonthOptions(selectedMonth) {
        var months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
        return months.map((m, i) => `<option value="${i + 1}" ${selectedMonth == (i + 1) ? 'selected' : ''}>${m}</option>`).join('');
    }

    function getDayOptions(selectedDay, maxDay) {
        maxDay = maxDay || 31;
        var html = '';
        for (var i = 1; i <= maxDay; i++) html += `<option value="${i}" ${selectedDay == i ? 'selected' : ''}>${i}</option>`;
        return html;
    }

    function getMaxDays(month) {
        return new Date(2001, month, 0).getDate();
    }

    function getWeekButtons(savedDays) {
        var days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        var shortDays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
        var saved = (savedDays || "").toLowerCase();

        return days.map((d, i) => {
            var isActive = saved.includes(d.toLowerCase());
            return `<button type="button" class="day-toggle ${isActive ? 'active' : ''}" data-day="${d}">${shortDays[i]}</button>`;
        }).join('');
    }

    function parseDateYMD(dateStr) {
        if (!dateStr) return null;
        var s = String(dateStr);
        // Fast path: ISO YYYY-MM-DD (with or without time/tz suffix)
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
        if (m) return { year: +m[1], month: +m[2], day: +m[3] };
        // Fallback for non-ISO formats: parse with Date and use UTC accessors
        // (date-only strings are UTC midnight per spec, so getUTC* is correct)
        var d = new Date(s);
        if (!isNaN(d.getTime())) return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
        return null;
    }

    function getDateRowHtml(interval) {
        var type = interval.Type || 'SpecificDate';
        if (type === 'EveryYear') console.log('[HSC schedule] raw interval from server:', JSON.stringify(interval));
        var sDate = interval.Start ? interval.Start.split('T')[0] : '';
        var eDate = interval.End ? interval.End.split('T')[0] : '';
        var sParts = parseDateYMD(interval.Start);
        var eParts = parseDateYMD(interval.End);
        var sMonth = sParts ? sParts.month : 12;
        var sDay   = sParts ? sParts.day   : 1;
        var eMonth = eParts ? eParts.month : 12;
        var eDay   = eParts ? eParts.day   : 28;
        var sMaxDay = getMaxDays(sMonth);
        var eMaxDay = getMaxDays(eMonth);
        sDay = Math.min(sDay, sMaxDay);
        eDay = Math.min(eDay, eMaxDay);
        var dayOfWeek = interval.DayOfWeek || '';

        return `
            <div class="date-row date-row-container" style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 15px;">
                
                <div style="width:160px;">
                    <label class="selectLabel">规则类型</label>
                    <select is="emby-select" class="selDateType" style="width:100%;">
                        <option value="SpecificDate" ${type === 'SpecificDate' ? 'selected' : ''}>指定日期</option>
                        <option value="EveryYear" ${type === 'EveryYear' ? 'selected' : ''}>每年重复</option>
                        <option value="Weekly" ${type === 'Weekly' ? 'selected' : ''}>每周指定日</option>
                    </select>
                </div>
                
                <div class="inputs-specific" style="display: ${type === 'SpecificDate' ? 'flex' : 'none'}; gap: 8px; flex-grow: 1; align-items: center;">
                    <div style="flex-grow:1;">
                        <input is="emby-input" type="date" class="txtFullStartDate" label="开始日期" value="${sDate}" />
                    </div>
                    <span style="opacity:0.5; padding-top:15px;">至</span>
                    <div style="flex-grow:1;">
                        <input is="emby-input" type="date" class="txtFullEndDate" label="结束日期" value="${eDate}" />
                    </div>
                </div>

                <div class="inputs-annual" style="display: ${type === 'EveryYear' ? 'flex' : 'none'}; gap: 8px; flex-grow: 1; align-items: flex-start;">
                    
                    <div style="display:flex; display:flex; gap:5px;">
                        <div style="width:80px;">
                            <label class="selectLabel">开始月份</label>
                            <select is="emby-select" class="selStartMonth" style="width:100%;">${getMonthOptions(sMonth)}</select>
                        </div>
                        <div style="width:70px;">
                            <label class="selectLabel">日</label>
                            <select is="emby-select" class="selStartDay" style="width:100%;">${getDayOptions(sDay, sMaxDay)}</select>
                        </div>
                    </div>

                    <span style="opacity:0.5; padding-top:32px;">至</span>

                    <div style="display:flex; display:flex; gap:5px;">
                        <div style="width:80px;">
                            <label class="selectLabel">结束月份</label>
                            <select is="emby-select" class="selEndMonth" style="width:100%;">${getMonthOptions(eMonth)}</select>
                        </div>
                        <div style="width:70px;">
                            <label class="selectLabel">日</label>
                            <select is="emby-select" class="selEndDay" style="width:100%;">${getDayOptions(eDay, eMaxDay)}</select>
                        </div>
                    </div>
                </div>

                <div class="inputs-weekly" style="display: ${type === 'Weekly' ? 'flex' : 'none'}; flex-grow: 1; align-items: center; gap: 5px; flex-wrap: wrap;">
                    <div style="width:100%;">
                        <label class="selectLabel">生效日</label>
                        <div class="week-btn-container" style="display:flex; gap:5px; margin-top:2px;">
                            ${getWeekButtons(dayOfWeek)}
                        </div>
                    </div>
                </div>

                <button type="button" is="emby-button" class="btnRemoveDate" style="background:transparent; color:#cc3333; min-width:40px; margin-top: 25px;" title="移除规则"><i class="md-icon">delete</i></button>
            </div>`;
    }

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.tag-row:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function readRowAsConfig(row) {
        var entryLabel = row.querySelector('.txtEntryLabel').value;
        var tagName = row.querySelector('.txtTagName').value || entryLabel;
        var active = row.querySelector('.chkTagActive').checked;
        var blInput = row.querySelector('.txtTagBlacklist');
        var bl = blInput ? blInput.value.split(/[\n\r]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; }) : [];
        var enableTag = row.querySelector('.chkEnableTag').checked;
        var enableColl = row.querySelector('.chkEnableCollection').checked;
        var overrideWhenActive = !!(row.querySelector('.chkOverrideWhenActive') || {}).checked;
        var _plTab = row.querySelector('.playlist-tab');
        var _plUserIds = _plTab && _plTab.dataset.plLoaded === '1'
            ? Array.from(_plTab.querySelectorAll('.chkPlaylistUser:checked')).map(function(c) { return c.value; })
            : (function() { try { return JSON.parse(decodeURIComponent((_plTab && _plTab.dataset.plUserids) || '%5B%5D')); } catch { return []; } })();
        var collName = row.querySelector('.txtCollectionName').value;
        var collSortName = row.querySelector('.txtCollectionSortName') ? row.querySelector('.txtCollectionSortName').value.trim() : '';
        var collDesc = row.querySelector('.txtCollectionDescription') ? row.querySelector('.txtCollectionDescription').value : '';
        var collPoster = row.querySelector('.hiddenPosterPath') ? row.querySelector('.hiddenPosterPath').value : '';
        var st = row.querySelector('.selSourceType').value;

        var intervals = [];
        row.querySelectorAll('.date-row').forEach(function(dr) {
            var type = dr.querySelector('.selDateType').value;
            var s = null, e = null, days = '';
            if (type === 'SpecificDate') {
                s = dr.querySelector('.txtFullStartDate').value;
                e = dr.querySelector('.txtFullEndDate').value;
            } else if (type === 'EveryYear') {
                var sM = dr.querySelector('.selStartMonth').value, sD = dr.querySelector('.selStartDay').value;
                var eM = dr.querySelector('.selEndMonth').value, eD = dr.querySelector('.selEndDay').value;
                s = '2000-' + sM.padStart(2, '0') + '-' + sD.padStart(2, '0');
                e = '2000-' + eM.padStart(2, '0') + '-' + eD.padStart(2, '0');
            } else if (type === 'Weekly') {
                days = Array.from(dr.querySelectorAll('.day-toggle.active')).map(function(b) { return b.dataset.day; }).join(',');
            }
            intervals.push({ Type: type, Start: s || null, End: e || null, DayOfWeek: days });
        });

        var miFilters = [];
        row.querySelectorAll('.mediainfo-filter-group').forEach(function(group, gi) {
            var operator = group.dataset.op || 'AND';
            var groupOp = gi === 0 ? 'AND' : (group.dataset.groupOp || 'AND');
            var criteria = [];
            group.querySelectorAll('.mi-rule').forEach(function(rule) {
                var prop = (rule.querySelector('.selMiProperty') || {}).value || '';
                var selVal = rule.querySelector('.selMiValue');
                var txtVal = rule.querySelector('.txtMiValue');
                var selOp  = rule.querySelector('.selMiOp');
                var txtNum = rule.querySelector('.txtMiNum');
                var selUser = rule.querySelector('.selMiUser');
                var selTextOp = rule.querySelector('.selMiTextOp');
                var val = selVal ? selVal.value : (txtVal ? txtVal.value.replace(/\r?\n/g, '\n').trim() : '');
                // MediaType:Episode + "Include parent series" → save as EpisodeIncludeSeries
                if (prop === 'MediaType' && val === 'Episode') {
                    var incParentChk = rule.querySelector('.chkIncludeParentSeries');
                    if (incParentChk && incParentChk.checked) val = 'EpisodeIncludeSeries';
                }
                var op2 = selOp ? selOp.value : '';
                var textMatchOp = selTextOp ? selTextOp.value : '';
                var num = txtNum ? txtNum.value.trim() : '';
                var userId = selUser ? selUser.value : '';
                var finalOp = op2 || textMatchOp;
                var finalVal = op2 ? num : val;
                var notBtn = rule.querySelector('.btnNotToggle');
                var isNot = notBtn && notBtn.dataset.not === '1';
                var crit = buildCriterion(prop, finalOp, finalVal, userId);
                if (crit) criteria.push(isNot ? '!' + crit : crit);
            });
            if (criteria.length > 0) miFilters.push({ Operator: operator, Criteria: criteria, GroupOperator: groupOp });
        });

        var hseTab = row.querySelector('.homescreen-tab');
        var enableHse = hseTab ? !!(hseTab.querySelector('.chkEnableHomeSection') || {}).checked : false;
        var hseLibraryId = hseTab && hseTab.dataset.hseLoaded === '1'
            ? ((hseTab.querySelector('.selHseLibrary') || {}).value || 'auto')
            : decodeURIComponent((hseTab && hseTab.dataset.hseLibraryid) || 'auto');
        var hseUserIds = hseTab && hseTab.dataset.hseLoaded === '1'
            ? Array.from(hseTab.querySelectorAll('.chkHseUser:checked')).map(function(c) { return c.value; })
            : (function() { try { return JSON.parse(decodeURIComponent((hseTab && hseTab.dataset.hseUserids) || '%5B%5D')); } catch(ex) { return []; } })();
        var hseSettings = {};
        if (hseTab && hseTab.dataset.hseLoaded === '1') {
            hseTab.querySelectorAll('[data-field]').forEach(function(el) {
                var f = el.dataset.field;
                var v = el.type === 'checkbox' ? String(el.checked) : el.value;
                // If field is empty, fall back to placeholder (e.g. CustomName uses display name as placeholder)
                if (v === '' && el.placeholder) v = el.placeholder;
                hseSettings[f] = v;
            });
            var itemTypesVal = (hseTab.querySelector('.selHseItemTypes') || {}).value || 'Movie,Series';
            hseSettings['ItemTypes'] = JSON.stringify(itemTypesVal.split(','));
            // Compute excluded library IDs from unchecked boxes → stored in _queryExcludeViewIds → Query.ExcludeUserViewIds
            var _excludedLibIds = Array.from(hseTab.querySelectorAll('.chkHseLibrary:not(:checked)')).map(function(c) { return c.value; });
            if (_excludedLibIds.length > 0) hseSettings['_queryExcludeViewIds'] = _excludedLibIds.join(',');
            else delete hseSettings['_queryExcludeViewIds'];
        } else {
            try { hseSettings = JSON.parse(decodeURIComponent((hseTab && hseTab.dataset.hseSettings) || '%7B%7D')); } catch(ex) {}
            // Mirror the placeholder fallback from the loaded-form path: use group name as CustomName when not explicitly set
            if (!hseSettings.CustomName) {
                var _hseDefaultName = (row.querySelector('.txtEntryLabel') || {}).value
                    || (row.querySelector('.txtTagName') || {}).value || '';
                if (_hseDefaultName) hseSettings.CustomName = _hseDefaultName;
            }
        }

        var urls = [];
        row.querySelectorAll('.url-row').forEach(function(uRow) {
            urls.push({ url: uRow.querySelector('.txtTagUrl').value.trim(), limit: parseInt(uRow.querySelector('.txtUrlLimit').value, 10) || 0 });
        });
        if (urls.length === 0) urls = [{ url: '', limit: 0 }];

        var localSources = [];
        row.querySelectorAll('.local-row').forEach(function(lRow) {
            localSources.push({ id: lRow.querySelector('.selLocalSource').value, limit: parseInt(lRow.querySelector('.txtLocalLimit').value, 10) || 0 });
        });

        var miLimit = parseInt((row.querySelector('.txtMediaInfoLimit') || {}).value, 10) || 0;

        var aiProvider = (row.querySelector('.selAiProvider') || {}).value || 'OpenAI';
        var aiPrompt = (row.querySelector('.txtAiPrompt') || {}).value || '';
        var aiIncludeRecentlyWatched = !!(row.querySelector('.chkAiRecentlyWatched') || {}).checked;
        var aiRecentlyWatchedUserId = (row.querySelector('.selAiWatchedUser') || {}).value || '';
        var aiRecentlyWatchedCount = parseInt((row.querySelector('.txtAiWatchedCount') || {}).value, 10) || 20;
        var aiRefreshIntervalDays = parseInt((row.querySelector('.txtAiRefreshInterval') || {}).value, 10) || 0;

        return {
            Name: entryLabel, Tag: tagName, Active: active, Blacklist: bl, ActiveIntervals: intervals,
            EnableTag: enableTag, EnableCollection: enableColl, CollectionName: collName, CollectionSortName: collSortName,
            CollectionDescription: collDesc, CollectionPosterPath: collPoster,
            OverrideWhenActive: overrideWhenActive, SourceType: st,
            Urls: urls, LocalSources: localSources, Limit: miLimit,
            MediaInfoFilters: miFilters, MediaInfoConditions: [],
            EnableHomeSection: enableHse, HomeSectionLibraryId: hseLibraryId,
            HomeSectionUserIds: hseUserIds, HomeSectionSettings: JSON.stringify(hseSettings),
            HomeSectionTracked: [], LastModified: new Date().toISOString(),
            AiProvider: aiProvider, AiPrompt: aiPrompt,
            AiIncludeRecentlyWatched: aiIncludeRecentlyWatched,
            AiRecentlyWatchedUserId: aiRecentlyWatchedUserId,
            AiRecentlyWatchedCount: aiRecentlyWatchedCount,
            AiRefreshIntervalDays: aiRefreshIntervalDays,
            TagTargetEpisode:        !!(row.querySelector('.chkTagTargetEpisode')  || {}).checked,
            TagTargetSeason:         !!(row.querySelector('.chkTagTargetSeason')   || {}).checked,
            TagTargetSeries:         !!(row.querySelector('.chkTagTargetSeries')   || {}).checked,
            CollectionTargetEpisode: !!(row.querySelector('.chkCollTargetEpisode') || {}).checked,
            CollectionTargetSeason:  !!(row.querySelector('.chkCollTargetSeason')  || {}).checked,
            CollectionTargetSeries:  !!(row.querySelector('.chkCollTargetSeries')  || {}).checked,
            EnablePlaylist:   !!(row.querySelector('.chkEnablePlaylist') || {}).checked,
            PlaylistName:     (row.querySelector('.txtPlaylistName') || { value: '' }).value,
            PlaylistUserIds:  _plUserIds,
            PlaylistMappings: (function() { try { return JSON.parse(decodeURIComponent((_plTab && _plTab.dataset.plMappings) || '%5B%5D')); } catch { return []; } })(),
            MediaInfoTargetEpisode: false, MediaInfoTargetSeason: false, MediaInfoTargetSeries: false,
            MediaInfoTargetType: '', MediaInfoSeasonMode: false,
        };
    }

    var _formAc = null;

    var MI_CRITERION_MAP = {
        '4K': { prop: 'Resolution', val: '4K' }, '8K': { prop: 'Resolution', val: '8K' },
        '1080p': { prop: 'Resolution', val: '1080p' }, '720p': { prop: 'Resolution', val: '720p' },
        'SD': { prop: 'Resolution', val: 'SD' },
        'HEVC': { prop: 'VideoCodec', val: 'HEVC' }, 'AV1': { prop: 'VideoCodec', val: 'AV1' },
        'H264': { prop: 'VideoCodec', val: 'H264' },
        'HDR': { prop: 'HDR', val: 'HDR' }, 'DolbyVision': { prop: 'HDR', val: 'DolbyVision' },
        'HDR10': { prop: 'HDR', val: 'HDR10' },
        'Atmos': { prop: 'AudioFormat', val: 'Atmos' }, 'TrueHD': { prop: 'AudioFormat', val: 'TrueHD' },
        'DtsHdMa': { prop: 'AudioFormat', val: 'DtsHdMa' }, 'DTS': { prop: 'AudioFormat', val: 'DTS' },
        'AC3': { prop: 'AudioFormat', val: 'AC3' }, 'AAC': { prop: 'AudioFormat', val: 'AAC' },
        '7.1': { prop: 'AudioChannels', val: '7.1' }, '5.1': { prop: 'AudioChannels', val: '5.1' },
        'Stereo': { prop: 'AudioChannels', val: 'Stereo' }, 'Mono': { prop: 'AudioChannels', val: 'Mono' }
    };
    var MI_REVERSE_MAP = {};
    Object.keys(MI_CRITERION_MAP).forEach(function (k) {
        var m = MI_CRITERION_MAP[k];
        MI_REVERSE_MAP[m.prop + ':' + m.val] = k;
    });

    // Migrate legacy comma-separated values to newline-separated on first load.
    // Only converts if the string contains commas but no newlines.
    function migrateCommaSeparated(val) {
        if (!val || val.indexOf('\n') >= 0) return val;
        if (val.indexOf(',') < 0) return val;
        return val.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; }).join('\n');
    }

    function parseCriterion(crit) {
        if (!crit) return { prop: 'Resolution', op: '', val: '', userId: '', not: false };
        var not = crit.charAt(0) === '!';
        if (not) crit = crit.slice(1);
        // Handle Collection/Playlist before split(':') — names may contain colons
        var lcrit = crit.toLowerCase();
        if (lcrit.startsWith('collection:') || lcrit.startsWith('playlist:')) {
            var ci = crit.indexOf(':');
            return { prop: crit.substring(0, ci), op: '', val: crit.substring(ci + 1), userId: '', not: not };
        }
        var parts = crit.split(':');
        if (parts.length === 1) {
            var mapped = MI_CRITERION_MAP[crit];
            return mapped ? { prop: mapped.prop, op: '', val: mapped.val, userId: '', not: not } : { prop: '', op: '', val: crit, userId: '', not: not };
        }
        // Legacy "Tag:X" (no operator) is evaluated server-side as contains. Keep it explicit so
        // the exact default below doesn't silently turn it into exact on the next save.
        if (parts.length === 2) return { prop: parts[0], op: parts[0] === 'Tag' ? 'contains' : '', val: parts[1], userId: '', not: not };
        if (parts.length === 3) return { prop: parts[0], op: parts[1], val: parts[2], userId: '', not: not };
        if (parts.length === 4) return { prop: parts[0], userId: parts[1], op: parts[2], val: parts[3], not: not };
        return { prop: 'Resolution', op: '', val: '', userId: '', not: false };
    }

    function buildCriterion(prop, op, val, userId) {
        if (!prop || val === '') return '';
        if (userId) return prop + ':' + userId + ':' + op + ':' + val;
        if (op) return prop + ':' + op + ':' + val;
        var key = prop + ':' + val;
        return MI_REVERSE_MAP[key] || (prop + ':' + val);
    }

    var MI_DROPDOWN_OPTIONS = {
        Resolution: [['8K', '8K (7680p+)'], ['4K', '4K / UHD'], ['1080p', '1080p / FHD'], ['720p', '720p / HD'], ['SD', 'SD (<720p)']],
        VideoCodec: [['HEVC', 'HEVC / H.265'], ['AV1', 'AV1'], ['H264', 'H.264 / AVC']],
        HDR:        [['HDR', 'HDR（任意）'], ['DolbyVision', 'Dolby Vision'], ['HDR10', 'HDR10']],
        AudioFormat: [['Atmos', 'Dolby Atmos'], ['TrueHD', 'Dolby TrueHD'], ['DtsHdMa', 'DTS-HD MA'], ['DTS', 'DTS'], ['AC3', 'Dolby Digital / AC3'], ['AAC', 'AAC']],
        AudioChannels: [['7.1', '7.1+ 环绕声'], ['5.1', '5.1 环绕声'], ['Stereo', '立体声'], ['Mono', '单声道']],
        MediaType: [['Movie', '电影'], ['Series', '剧集'], ['Episode', '单集'], ['Audio', '音乐曲目（音频）'], ['MusicVideo', '音乐视频'], ['MusicAlbum', '音乐专辑'], ['MusicArtist', '音乐艺术家']],
        IsPlayed: [['Watched', '已观看'], ['Unwatched', '未观看']]
    };
    var MI_NUMERIC_PROPS = ['CommunityRating', 'Year', 'Runtime', 'DateAdded', 'DateModified', 'FileSize', 'LastPlayed', 'PlayCount', 'BitRate', 'SampleRate', 'BitsPerSample', 'TrackNumber', 'DiscNumber', 'WatchedByCount'];
    var MI_UNIT_LABELS = { DateAdded: '天前', DateModified: '天前', LastPlayed: '天前', FileSize: 'MB', PlayCount: '次播放', BitRate: 'kbps', SampleRate: 'Hz', BitsPerSample: '位', WatchedByCount: '位用户' };
    var MI_USER_PROPS = ['IsPlayed', 'LastPlayed', 'PlayCount'];
    var MI_TEXT_MATCH_PROPS = ['Tag', 'Title', 'EpisodeTitle', 'Overview', 'Studio', 'Genre', 'Actor', 'Director', 'Writer', 'ContentRating', 'AudioLanguage', 'Artist', 'Album', 'FolderPath', 'Country'];
    var MI_TEXT_MATCH_DEFAULT = {
        Title: 'contains', EpisodeTitle: 'contains', Overview: 'contains', Studio: 'contains', Genre: 'contains', Tag: 'exact',
        Actor: 'exact', Director: 'exact', Writer: 'exact', Artist: 'contains', Album: 'contains',
        ContentRating: 'exact', AudioLanguage: 'exact', FolderPath: 'contains', Country: 'contains'
    };
    var _miUsers = null;
    var MI_PRESETS = [
        { label: '分辨率', presets: [
            { name: '4K 电影',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Movie', '4K'] }]; } },
            { name: '1080p 电影',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Movie', '1080p'] }]; } },
            { name: 'HD 及以下电影（≤720p）',
              build: function() { return [
                  { Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Movie'] },
                  { Operator:'OR',  GroupOperator:'AND', Criteria:['720p', 'SD'] }
              ]; } }
        ]},
        { label: '发行年份', presets: [
            { name: '1990 年代电影',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Movie','Year:>=:1990','Year:<=:1999'] }]; } },
            { name: '今年发行的电影',
              build: function() { var y = new Date().getFullYear(); return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Movie','Year:=:'+y] }]; } },
            { name: '近 5 年发行的电影',
              build: function() { var y = new Date().getFullYear()-5; return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Movie','Year:>=:'+y] }]; } }
        ]},
        { label: '近期', presets: [
            { name: '最近添加（近 30 天）',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['DateAdded:<=:30'] }]; } },
            { name: '最近修改（近 7 天）',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['DateModified:<=:7'] }]; } },
            { name: '最近播放（近 7 天）',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['LastPlayed:__any__:<=:7'] }]; } }
        ]},
        { label: '观看状态', presets: [
            { name: '未观看的电影',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Movie','IsPlayed:__any__:=:Unwatched'] }]; } },
            { name: '从未有人播放',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['IsPlayed:__all__:=:Unwatched'] }]; } },
            { name: '至少 2 位用户已观看',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['WatchedByCount:>=:2'] }]; } },
            { name: '所有人均未观看',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['WatchedByCount:=:0'] }]; } }
        ]},
        { label: '音乐', presets: [
            { name: '所有音乐曲目',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Audio'] }]; } },
            { name: '所有音乐视频',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:MusicVideo'] }]; } },
            { name: '无损音频（≥24 位）',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Audio', 'BitsPerSample:>=:24'] }]; } },
            { name: '高解析度音频（≥96 kHz）',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:Audio', 'SampleRate:>=:96000'] }]; } },
            { name: '4K 音乐视频',
              build: function() { return [{ Operator:'AND', GroupOperator:'AND', Criteria:['MediaType:MusicVideo', '4K'] }]; } }
        ]}
    ];
    var MI_TEXT_PLACEHOLDERS = {
        Title: '例如：虚构影片甲, 虚构影片乙', EpisodeTitle: '例如：首集, 大结局', Overview: '例如：劫案, 时间旅行',
        Studio: '例如：Warner, Netflix, HBO', Genre: '例如：动作, 惊悚',
        Actor: '例如：Tom Hanks, Idris Elba', Director: '例如：Nolan, Tarantino', Writer: '例如：Tarantino, Nolan',
        ContentRating: '例如：PG-13, R', AudioLanguage: '例如：eng, swe', ImdbId: '例如：tt&lt;作品ID&gt;, tt&lt;另一作品ID&gt;',
        TvdbId: '例如：&lt;作品ID&gt;',
        FolderPath: '例如：/movies/action',
        Country: '例如：美国',
        Artist: '例如：Radiohead, Pink Floyd', Album: '例如：虚构专辑甲, 虚构专辑乙'
    };

    function propertyOptionsHtml(selected) {
        var groups = [
            { label: '视频', props: [['Resolution','分辨率'], ['VideoCodec','视频编码'], ['HDR','HDR']] },
            { label: '音频', props: [['AudioFormat','音频格式'], ['AudioChannels','音频声道'], ['AudioLanguage','音频语言']] },
            { label: '内容', props: [['MediaType','媒体类型'], ['Tag','标签'], ['Title','标题'], ['EpisodeTitle','标题（单集）'], ['Overview','简介'], ['Studio','制作公司'], ['Genre','类型'], ['Actor','演员'], ['Director','导演'], ['Writer','编剧'], ['ContentRating','内容分级'], ['ImdbId','IMDB ID'], ['TvdbId','TVDB ID'], ['Country','国家'], ['Collection','所属合集'], ['Playlist','所属播放列表']] },
            { label: '音乐', props: [['Artist','艺术家'], ['Album','专辑'], ['BitRate','比特率（kbps）'], ['SampleRate','采样率（Hz）'], ['BitsPerSample','位深'], ['TrackNumber','曲目编号'], ['DiscNumber','碟片编号']] },
            { label: '指标', props: [['CommunityRating','社区评分'], ['Year','年份'], ['Runtime','时长（分钟）'], ['DateAdded','添加日期'], ['DateModified','修改日期'], ['FileSize','文件大小（MB）'], ['FolderPath','文件夹路径']] },
            { label: '活动', props: [['IsPlayed','已观看 / 未观看'], ['LastPlayed','上次播放'], ['PlayCount','播放次数'], ['WatchedByCount','已观看用户数']] }
        ];
        return groups.map(function (g) {
            return '<optgroup label="' + g.label + '">' +
                g.props.map(function (p) {
                    return '<option value="' + p[0] + '"' + (p[0] === selected ? ' selected' : '') + '>' + p[1] + '</option>';
                }).join('') +
                '</optgroup>';
        }).join('');
    }

    function getMiValueHtml(prop, savedOp, savedVal, savedUserId) {
        var userHtml = '';
        if (MI_USER_PROPS.indexOf(prop) >= 0) {
            var specialOpts =
                '<option value="__any__"' + ('__any__' === savedUserId ? ' selected' : '') + '>任意用户</option>' +
                '<option value="__all__"' + ('__all__' === savedUserId ? ' selected' : '') + '>所有用户</option>';
            var uOpts = specialOpts + (_miUsers || []).map(function (u) {
                return '<option value="' + u.Id + '"' + (u.Id === savedUserId ? ' selected' : '') + '>' + u.Name + '</option>';
            }).join('');
            userHtml = '<select class="selMiUser" is="emby-select" style="flex:0 0 auto;min-width:110px;">' + uOpts + '</select>';
        }
        var unitLabel = MI_UNIT_LABELS[prop] ? '<span style="margin-left:4px;opacity:.7;white-space:nowrap;">' + MI_UNIT_LABELS[prop] + '</span>' : '';
        if (prop === 'Collection' || prop === 'Playlist') {
            var cpList = prop === 'Collection' ? cachedCollections : cachedPlaylists;
            var cpOpts = cpList.map(function (o) {
                var n = o.Name || '';
                return '<option value="' + n.replace(/"/g, '&quot;') + '"' + (n === savedVal ? ' selected' : '') + '>' + n + '</option>';
            }).join('');
            return '<select class="selMiValue" is="emby-select" style="flex:1;"><option value="">-- 请选择 --</option>' + cpOpts + '</select>';
        }
        if (prop === 'Tag') {
            var tagTextOp = savedOp || MI_TEXT_MATCH_DEFAULT['Tag'];
            var tagTextOpHtml = '<select class="selMiTextOp" is="emby-select" style="flex:0 0 100px;">' +
                '<option value="contains"' + (tagTextOp === 'contains' ? ' selected' : '') + '>包含</option>' +
                '<option value="exact"' + (tagTextOp === 'exact' ? ' selected' : '') + '>完全匹配</option>' +
                '</select>';
            if (cachedTags.length > 0) {
                var tagOpts = cachedTags.map(function (t) {
                    return '<option value="' + t.replace(/"/g, '&quot;') + '"' + (t === savedVal ? ' selected' : '') + '>' + t + '</option>';
                }).join('');
                return tagTextOpHtml + '<select class="selMiValue" is="emby-select" style="flex:1;"><option value="">-- 选择标签 --</option>' + tagOpts + '</select>';
            }
            var migratedTagVal = migrateCommaSeparated(savedVal || '');
            return tagTextOpHtml + '<textarea class="txtMiValue" placeholder="例如：4K" rows="1" style="flex:1;resize:none;overflow:hidden;padding:6px 8px;font-size:inherit;font-family:inherit;background:var(--plugin-input-bg,rgba(255,255,255,0.08));border:1px solid var(--plugin-input-border,rgba(255,255,255,0.2));border-radius:3px;color:inherit;line-height:1.4;min-height:32px;max-height:120px;overflow-y:auto;">' + migratedTagVal.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</textarea>';
        }
        if (MI_DROPDOWN_OPTIONS[prop]) {
            if (prop === 'MediaType') {
                var dispVal = (savedVal === 'EpisodeIncludeSeries') ? 'Episode' : (savedVal || '');
                var mtOpts = MI_DROPDOWN_OPTIONS['MediaType'].map(function (pair) {
                    return '<option value="' + pair[0] + '"' + (pair[0] === dispVal ? ' selected' : '') + '>' + pair[1] + '</option>';
                }).join('');
                var ipChecked = (savedVal === 'EpisodeIncludeSeries') ? 'checked' : '';
                var ipDisplay = (dispVal === 'Episode') ? 'inline-flex' : 'none';
                return '<select class="selMiValue" is="emby-select" style="flex:1;">' + mtOpts + '</select>' +
                    '<label class="mi-include-parent" style="display:' + ipDisplay + '; align-items:center; gap:6px; cursor:pointer; white-space:nowrap; font-size:0.85em; margin:0;">' +
                    '<input type="checkbox" class="chkIncludeParentSeries" ' + ipChecked + ' style="margin:0;">' +
                    '<span>同时包含所属剧集</span>' +
                    '</label>';
            }
            var opts = MI_DROPDOWN_OPTIONS[prop].map(function (pair) {
                return '<option value="' + pair[0] + '"' + (pair[0] === savedVal ? ' selected' : '') + '>' + pair[1] + '</option>';
            }).join('');
            return userHtml + '<select class="selMiValue" is="emby-select" style="flex:1;">' + opts + '</select>';
        }
        if (MI_NUMERIC_PROPS.indexOf(prop) >= 0) {
            var ops = ['=', '>', '>=', '<', '<='];
            var defaultOp = (prop === 'PlayCount') ? '>=' : '<=';
            var opOpts = ops.map(function (o) {
                return '<option value="' + o + '"' + (o === (savedOp || defaultOp) ? ' selected' : '') + '>' + o + '</option>';
            }).join('');
            var infoTooltip =
                '<div class="mi-op-info">' +
                '<div class="mi-op-info-icon">i</div>' +
                '<div class="mi-op-tooltip"><table>' +
                '<tr><td>=</td><td>等于</td></tr>' +
                '<tr><td>&gt;</td><td>大于</td></tr>' +
                '<tr><td>&gt;=</td><td>大于或等于</td></tr>' +
                '<tr><td>&lt;</td><td>小于</td></tr>' +
                '<tr><td>&lt;=</td><td>小于或等于</td></tr>' +
                '</table></div></div>';
            var numStep = (prop === 'PlayCount') ? '1' : '0.01';
            return userHtml +
                '<select class="selMiOp" is="emby-select" style="flex:0 0 64px;">' + opOpts + '</select>' +
                infoTooltip +
                '<input class="txtMiNum" is="emby-input" type="number" step="' + numStep + '" value="' + (savedVal || '') + '" style="flex:1;" />' +
                unitLabel;
        }
        if (MI_TEXT_MATCH_PROPS.indexOf(prop) >= 0) {
            var textOp = savedOp || MI_TEXT_MATCH_DEFAULT[prop] || 'contains';
            var textOpHtml = '<select class="selMiTextOp" is="emby-select" style="flex:0 0 100px;">' +
                '<option value="contains"' + (textOp === 'contains' ? ' selected' : '') + '>包含</option>' +
                '<option value="exact"' + (textOp === 'exact' ? ' selected' : '') + '>完全匹配</option>' +
                '</select>';
            var ph = MI_TEXT_PLACEHOLDERS[prop] || '';
            var ph = MI_TEXT_PLACEHOLDERS[prop] || '';
            var migratedVal = migrateCommaSeparated(savedVal || '');
            return textOpHtml + '<textarea class="txtMiValue" placeholder="' + ph + '" rows="1" style="flex:1;resize:none;overflow:hidden;padding:6px 8px;font-size:inherit;font-family:inherit;background:var(--plugin-input-bg,rgba(255,255,255,0.08));border:1px solid var(--plugin-input-border,rgba(255,255,255,0.2));border-radius:3px;color:inherit;line-height:1.4;min-height:32px;max-height:120px;overflow-y:auto;">' + migratedVal.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</textarea>';
        }
        var ph = MI_TEXT_PLACEHOLDERS[prop] || '';
        var migratedVal = migrateCommaSeparated(savedVal || '');
        return '<textarea class="txtMiValue" placeholder="' + ph + '" rows="1" style="flex:1;resize:none;overflow:hidden;padding:6px 8px;font-size:inherit;font-family:inherit;background:var(--plugin-input-bg,rgba(255,255,255,0.08));border:1px solid var(--plugin-input-border,rgba(255,255,255,0.2));border-radius:3px;color:inherit;line-height:1.4;min-height:32px;max-height:120px;overflow-y:auto;">' + migratedVal.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</textarea>';
    }

    function getMiHintHtml(prop) {
        if (MI_TEXT_MATCH_PROPS.indexOf(prop) < 0 && prop !== 'ImdbId' && prop !== 'TvdbId') return '<div class="mi-rule-hint"></div>';
        return '<div class="mi-rule-hint" style="font-size:0.75em; opacity:0.5; margin-top:2px; padding-right:32px; text-align:right;">每行一个值 &mdash; <em>任意</em>一行匹配即满足条件（或）</div>';
    }

    function getMediaInfoRuleHtml(criterion) {
        var parsed = parseCriterion(criterion || '');
        var prop = parsed.prop || 'Resolution';
        var notActive = parsed.not;
        var notBg = notActive ? 'rgba(200,50,50,0.75)' : 'transparent';
        var notColor = notActive ? '#fff' : '';
        var notBorder = notActive ? '1px solid rgba(200,50,50,0.6)' : '1px solid rgba(128,128,128,0.4)';
        return '<div class="mi-rule" style="margin-bottom:6px;">' +
            '<div style="display:flex; gap:6px; align-items:center;">' +
            '<button type="button" class="btnNotToggle" data-not="' + (notActive ? '1' : '0') + '"' +
            ' style="border:' + notBorder + '; border-radius:10px; padding:3px 10px; font-size:0.78em; font-weight:bold; cursor:pointer; letter-spacing:0.5px; flex-shrink:0;' +
            ' background:' + notBg + '; color:' + notColor + ';" title="对此规则取反">非</button>' +
            '<select class="selMiProperty" is="emby-select" style="flex:0 0 155px;">' + propertyOptionsHtml(prop) + '</select>' +
            '<div class="mi-value-wrapper" style="flex:1; display:flex; gap:6px; align-items:center;">' + getMiValueHtml(prop, parsed.op, parsed.val, parsed.userId || '') + '</div>' +
            '<button type="button" class="btnRemoveMiRule" style="background:transparent; border:none; color:#cc3333; cursor:pointer; padding:2px 8px; font-size:1em; flex-shrink:0;" title="移除规则">✕</button>' +
            '</div>' +
            getMiHintHtml(prop) +
            '</div>';
    }

    function getMediaInfoFilterGroupHtml(filter, _i, isFirst) {
        var op = (filter && filter.Operator) || 'AND';
        var groupOp = (filter && filter.GroupOperator) || 'AND';
        var criteria = (filter && filter.Criteria) || [];

        var connectorHtml = isFirst ? '' :
            '<div class="mi-group-connector" style="display:flex; align-items:center; gap:10px; margin:-12px -12px 14px; padding:8px 14px; background:rgba(0,0,0,0.12);">' +
                '<div style="flex:1; height:1px; background:rgba(128,128,128,0.25);"></div>' +
                '<div style="display:flex; flex-direction:column; align-items:center; gap:4px;">' +
                    '<span style="font-size:0.7em; text-transform:uppercase; letter-spacing:1px; opacity:0.45;">组间连接方式</span>' +
                    '<div style="display:flex; border-radius:14px; overflow:hidden; border:1px solid rgba(128,128,128,0.4);">' +
                        '<button type="button" class="btnGroupOpChoice" data-value="AND"' +
                        ' style="border:none; padding:4px 16px; font-size:0.82em; font-weight:bold; cursor:pointer; letter-spacing:0.5px;' +
                        ' background:' + (groupOp === 'AND' ? 'rgba(0,164,220,0.75)' : 'transparent') + ';' +
                        ' color:' + (groupOp === 'AND' ? '#fff' : 'inherit') + ';"' +
                        ' title="两个筛选组都必须匹配">且</button>' +
                        '<div style="width:1px; background:rgba(128,128,128,0.4);"></div>' +
                        '<button type="button" class="btnGroupOpChoice" data-value="OR"' +
                        ' style="border:none; padding:4px 16px; font-size:0.82em; font-weight:bold; cursor:pointer; letter-spacing:0.5px;' +
                        ' background:' + (groupOp === 'OR' ? 'rgba(220,120,0,0.75)' : 'transparent') + ';' +
                        ' color:' + (groupOp === 'OR' ? '#fff' : 'inherit') + ';"' +
                        ' title="任一筛选组匹配即可">或</button>' +
                    '</div>' +
                    '<span class="group-op-desc" style="font-size:0.7em; opacity:0.55; white-space:nowrap;">' +
                        (groupOp === 'AND' ? '两个组都必须匹配' : '任一组匹配即可') +
                    '</span>' +
                '</div>' +
                '<div style="flex:1; height:1px; background:rgba(128,128,128,0.25);"></div>' +
            '</div>';

        var rulesHtml = criteria.map(function (c) { return getMediaInfoRuleHtml(c); }).join('');

        return '<div class="mediainfo-filter-group" data-group-op="' + groupOp + '" data-op="' + op + '" style="border:1px solid rgba(128,128,128,0.3); border-radius:6px; padding:12px; margin-bottom:10px; background:rgba(128,128,128,0.03);">' +
            connectorHtml +
            '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">' +
                '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
                    '<span style="font-size:0.8em; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; opacity:0.6;">规则匹配方式：</span>' +
                    '<div style="display:flex; flex-direction:column; gap:3px;">' +
                        '<div style="display:flex; border-radius:14px; overflow:hidden; border:1px solid rgba(128,128,128,0.4);">' +
                            '<button type="button" class="btnGroupInnerOpChoice" data-value="AND"' +
                            ' style="border:none; padding:4px 16px; font-size:0.82em; font-weight:bold; cursor:pointer; letter-spacing:0.5px;' +
                            ' background:' + (op === 'AND' ? 'rgba(0,164,220,0.75)' : 'transparent') + ';' +
                            ' color:' + (op === 'AND' ? '#fff' : 'inherit') + ';"' +
                            ' title="此组中的所有规则都必须匹配">全部</button>' +
                            '<div style="width:1px; background:rgba(128,128,128,0.4);"></div>' +
                            '<button type="button" class="btnGroupInnerOpChoice" data-value="OR"' +
                            ' style="border:none; padding:4px 16px; font-size:0.82em; font-weight:bold; cursor:pointer; letter-spacing:0.5px;' +
                            ' background:' + (op === 'OR' ? 'rgba(220,120,0,0.75)' : 'transparent') + ';' +
                            ' color:' + (op === 'OR' ? '#fff' : 'inherit') + ';"' +
                            ' title="此组中任一规则匹配即可">任意</button>' +
                        '</div>' +
                        '<span class="inner-op-desc" style="font-size:0.7em; opacity:0.55;">' +
                            (op === 'AND' ? '所有规则都必须匹配' : '任一规则匹配即可') +
                        '</span>' +
                    '</div>' +
                '</div>' +
                '<button type="button" class="btnRemoveFilterGroup" style="background:transparent; border:none; color:#cc3333; cursor:pointer; padding:2px 8px; font-size:0.85em; flex-shrink:0;">✕ 移除</button>' +
            '</div>' +
            '<div class="mi-rules-list">' + rulesHtml + '</div>' +
            '<button type="button" is="emby-button" class="btnAddMiRule raised btn-neutral" style="margin-top: 4px;">+ 添加规则</button>' +
            '</div>';
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function displayRunStatus(value) {
        return String(value || 'Never')
            .replace(/^Interrupted \(server restarted\)$/, '已中断（服务器已重启）')
            .replace(/^Never$/, '从未运行').replace(/^Idle$/, '空闲')
            .replace(/^Running(?:\.{3}|…)?/, '运行中')
            .replace(/^Dry run\s*[—-]\s*(.*)$/i, function (_, status) { return '仅预览 — ' + displayRunStatus(status); })
            .replace(/^Completed with /i, '已完成，')
            .replace(/(\d+) error\(s\)/g, '$1 个错误').replace(/(\d+) warning\(s\)/g, '$1 条警告')
            .replace(/ and /g, '、')
            .replace(/^Completed/i, '已完成').replace(/^Done/i, '已完成')
            .replace(/^Failed/i, '失败').replace(/^Skipped/i, '已跳过')
            .replace(/^Error:/i, '错误：');
    }

    function selectedAnimeAiProvider(view) {
        var selector = (view || document).querySelector('#selAnimeAiProvider');
        return selector && selector.value || 'OpenAICompatible';
    }

    function aiBudgetValue(view, selector, fallback) {
        var value = Number(view.querySelector(selector).value);
        return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
    }

    function updateCompatibleAiVisibility(view) {
        var provider = selectedAnimeAiProvider(view);
        var hint = view.querySelector('#animeAiProviderHint');
        if (!hint) return;
        hint.style.display = '';
        if (provider === 'OpenAICompatible') {
            hint.textContent = '请到下方「AI 设置 → OpenAI 兼容接口」填写地址、模型和密钥。不配也能自动分组。';
        } else {
            hint.textContent = '使用「设置 → AI 设置」中对应服务的密钥与模型。不配也能自动分组。';
        }
    }

    function updateCompatibleAiHttpWarning(view) {
        var input = view.querySelector('#txtCompatibleAiBaseUrl');
        var url = input ? input.value : '';
        var warn = view.querySelector('#compatibleAiHttpWarning');
        if (warn) warn.style.display = /^http:\/\//i.test((url || '').trim()) ? '' : 'none';
    }

    function updateAiHttpWarning(view) {
        updateCompatibleAiVisibility(view);
        updateCompatibleAiHttpWarning(view);
        var provider = selectedAnimeAiProvider(view);
        // Ollama HTTP is local by design; no extra banner here.
        void provider;
    }

    function animeAiRequest(path, configuration) {
        var headers = {};
        var token = window.ApiClient.accessToken();
        if (token) headers['X-Emby-Token'] = token;
        var options = { headers: headers, credentials: 'same-origin' };
        if (configuration) {
            options.method = 'POST';
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify({ Configuration: configuration });
        }
        return fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Ai/' + path), options)
            .then(function (response) {
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) throw new Error('需要管理员权限。');
                    throw new Error('请求失败（HTTP ' + response.status + '）。');
                }
                return response.json();
            });
    }

    function loadAnimeAiAnalysis(view) {
        var target = view.querySelector('#animeAiAnalysis');
        var button = view.querySelector('#btnRefreshAnimeAiAnalysis');
        button.disabled = true;
        target.textContent = '正在加载改名建议…';
        return animeAiRequest('Analysis').then(function (data) {
            target.textContent = '';
            function line(parent, label, value) {
                if (value === null || value === undefined || value === '') return;
                var element = document.createElement('div');
                element.style.whiteSpace = 'pre-wrap';
                element.textContent = label + String(value);
                parent.appendChild(element);
            }
            line(target, '更新时间：', data.UpdatedUtc ? new Date(data.UpdatedUtc).toLocaleString('zh-CN') : '尚无记录');
            (data.Warnings || []).forEach(function (warning) { line(target, '提示：', warning); });
            var kinds = { relation: '关系复核', naming: '中文命名', review: '合集检查', mapping: '查找建议' };
            var decisions = { same_ip: '同一作品系列', different_ip: '不同作品系列', uncertain: '无法判断', suggest: '建议改名', keep: '保持现状', split: '建议拆分', search: '建议人工查找' };
            var issueTypes = { cross_ip: '混入其他作品系列', duplicate: '重复媒体', branch: '分支待确认', naming: '名称问题', missing_local: '可能漏掉的本地作品' };
            var risks = { low: '低', medium: '中', high: '高' };
            var nameEvidence = { existing_title: '沿用现有标题', derived_prefix: '取自标题共同部分', unverified: '未经核实，请人工确认' };
            function label(map, value) { return value ? (map[value] || '其他') : ''; }
            function names(list) {
                var seen = {};
                return (list || []).map(function (x) { return x && x.Name; })
                    .filter(function (n) { if (!n || seen[n]) return false; seen[n] = true; return true; }).join('、');
            }
            var suggestions = data.Suggestions || [];
            if (!suggestions.length) line(target, '', '暂无改名建议。若需要，可在上方打开命名建议开关，到 AI 设置填好供应商，再同步一次后刷新。不配也能自动分组。');
            suggestions.forEach(function (suggestion) {
                var item = document.createElement('section');
                item.style.cssText = 'border-top:1px solid var(--line-color);margin-top:12px;padding-top:10px;';
                line(item, '建议类型：', label(kinds, suggestion.Kind));
                line(item, '合集：', suggestion.OriginalName || suggestion.GroupKey);
                line(item, '当前名称：', suggestion.OriginalName);
                line(item, '涉及作品：', names((suggestion.InputItems || []).concat(suggestion.InputTitles || [])));
                line(item, '建议名称：', suggestion.SuggestedName);
                if (suggestion.SuggestedName && suggestion.GroupKey) {
                    var adoptBtn = document.createElement('button');
                    adoptBtn.type = 'button';
                    adoptBtn.setAttribute('is', 'emby-button');
                    adoptBtn.className = 'raised button-submit';
                    adoptBtn.style.marginTop = '6px';
                    adoptBtn.textContent = '采用建议显示名';
                    adoptBtn.addEventListener('click', function () {
                        adoptAnimeSuggestedName(view, {
                            CollectionKey: suggestion.GroupKey,
                            SuggestedName: suggestion.SuggestedName
                        }, adoptBtn);
                    });
                    item.appendChild(adoptBtn);
                }
                line(item, '名称来源：', label(nameEvidence, suggestion.NameEvidenceStatus));
                line(item, '结论：', label(decisions, suggestion.Decision));
                line(item, '理由：', suggestion.Reason);
                (suggestion.ReviewIssues || []).forEach(function (issue) {
                    var details = document.createElement('div');
                    details.style.cssText = 'margin:8px 0;padding-left:12px;border-left:2px solid var(--line-color);';
                    line(details, '问题：', label(issueTypes, issue.IssueType));
                    line(details, '原因：', issue.Reason);
                    line(details, '风险：', label(risks, issue.RiskLevel));
                    line(details, '建议处理：', issue.RecommendedAction);
                    item.appendChild(details);
                });
                line(item, '生成时间：', suggestion.CreatedUtc ? new Date(suggestion.CreatedUtc).toLocaleString('zh-CN') : '');
                target.appendChild(item);
            });
        }).catch(function (error) {
            target.textContent = '暂时无法加载建议：' + (error.message || '网络或响应异常。可稍后重试。');
        }).then(function () { button.disabled = false; });
    }

    function readMiFiltersFromContainer(container) {
        var miFilters = [];
        container.querySelectorAll('.mediainfo-filter-group').forEach(function (group, gi) {
            var operator = group.dataset.op || 'AND';
            var groupOp = gi === 0 ? 'AND' : (group.dataset.groupOp || 'AND');
            var criteria = [];
            group.querySelectorAll('.mi-rule').forEach(function (rule) {
                var prop = (rule.querySelector('.selMiProperty') || {}).value || '';
                var selVal = rule.querySelector('.selMiValue');
                var txtVal = rule.querySelector('.txtMiValue');
                var selOp  = rule.querySelector('.selMiOp');
                var txtNum = rule.querySelector('.txtMiNum');
                var selUser = rule.querySelector('.selMiUser');
                var selTextOp = rule.querySelector('.selMiTextOp');
                var val = selVal ? selVal.value : (txtVal ? txtVal.value.replace(/\r?\n/g, '\n').trim() : '');
                if (prop === 'MediaType' && val === 'Episode') {
                    var incParentChk = rule.querySelector('.chkIncludeParentSeries');
                    if (incParentChk && incParentChk.checked) val = 'EpisodeIncludeSeries';
                }
                var op2 = selOp ? selOp.value : '';
                var textMatchOp = selTextOp ? selTextOp.value : '';
                var num = txtNum ? txtNum.value.trim() : '';
                var userId = selUser ? selUser.value : '';
                var finalOp = op2 || textMatchOp;
                var finalVal = op2 ? num : val;
                var notBtn = rule.querySelector('.btnNotToggle');
                var isNot = notBtn && notBtn.dataset.not === '1';
                var crit = buildCriterion(prop, finalOp, finalVal, userId);
                if (crit) criteria.push(isNot ? '!' + crit : crit);
            });
            if (criteria.length > 0) miFilters.push({ Operator: operator, Criteria: criteria, GroupOperator: groupOp });
        });
        return miFilters;
    }

    function getMySavedFiltersPanelHtml() {
        if (savedFilters.length === 0) {
            return '<div style="font-size:0.82em; color:var(--theme-text-secondary); font-style:italic; margin-bottom:4px;">暂无已保存的筛选器。</div>';
        }
        return '<div style="display:flex; flex-wrap:wrap; gap:6px;">' +
            savedFilters.map(function (sf, i) {
                return '<div style="display:flex; align-items:center; gap:0;">' +
                    '<button type="button" class="btnApplyMySavedFilter" data-index="' + i + '"' +
                    ' style="border:1.5px solid #000; border-radius:14px 0 0 14px; padding:4px 10px; font-size:0.82em; cursor:pointer; background:transparent; color:var(--theme-text-primary);">' +
                    escapeHtml(sf.Name) + '</button>' +
                    '<button type="button" class="btnDeleteMySavedFilter" data-index="' + i + '"' +
                    ' style="border:1.5px solid #000; border-left:none; border-radius:0 14px 14px 0; background:transparent; color:#cc3333; cursor:pointer; padding:4px 8px; font-size:0.82em; line-height:1;" title="删除">✕</button>' +
                    '</div>';
            }).join('') +
            '</div>';
    }

    function refreshMySavedFiltersPanels() {
        var v = document.querySelector('#HomeScreenCompanionConfigPage');
        if (!v) return;
        var html = getMySavedFiltersPanelHtml();
        v.querySelectorAll('.mi-saved-panel-content').forEach(function (el) {
            el.innerHTML = html;
        });
    }

    function saveSavedFiltersNow() {
        window.ApiClient.getPluginConfiguration(pluginId)
            .then(function (currentConfig) {
                currentConfig.SavedFilters = savedFilters;
                return window.ApiClient.updatePluginConfiguration(pluginId, currentConfig);
            })
            .then(function () {
                if (originalConfigState) {
                    try {
                        var state = JSON.parse(originalConfigState);
                        state.SavedFilters = savedFilters;
                        originalConfigState = JSON.stringify(state);
                    } catch (e) {}
                }
                var view = document.querySelector('#HomeScreenCompanionConfigPage');
                if (view) checkFormState();
            });
    }

    function isScheduleCurrentlyActive(intervals) {
        if (!intervals || intervals.length === 0) return false;
        var now = new Date();
        var dowNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        var todayName = dowNames[now.getDay()];
        return intervals.some(function(iv) {
            if (iv.Type === 'Weekly') {
                var days = (iv.DayOfWeek || '').split(',').map(function(d) { return d.trim(); });
                return days.indexOf(todayName) >= 0;
            }
            // Compare calendar dates (Y/M/D) only — both ends are inclusive, matching the server.
            var s = parseDateYMD(iv.Start);
            var e = parseDateYMD(iv.End);
            if (iv.Type === 'EveryYear') {
                if (!s || !e) return false;
                var nowMD = (now.getMonth() + 1) * 100 + now.getDate();
                var sMD  = s.month * 100 + s.day;
                var eMD  = e.month * 100 + e.day;
                // A window that wraps the new year (e.g. Dec 27 → Jan 3)
                return eMD >= sMD ? sMD <= nowMD && nowMD <= eMD : nowMD >= sMD || nowMD <= eMD;
            }
            // SpecificDate (an open start or end is unbounded, as on the server)
            if (!s && !e) return false;
            var nowYMD = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
            return (!s || s.year * 10000 + s.month * 100 + s.day <= nowYMD)
                && (!e || nowYMD <= e.year * 10000 + e.month * 100 + e.day);
        });
    }

    function readIntervalsFromRow(row) {
        var intervals = [];
        row.querySelectorAll('.date-row').forEach(function(dr) {
            var type = (dr.querySelector('.selDateType') || {}).value || 'SpecificDate';
            var s = null, e = null, days = '';
            if (type === 'SpecificDate') {
                s = (dr.querySelector('.txtFullStartDate') || {}).value || null;
                e = (dr.querySelector('.txtFullEndDate') || {}).value || null;
            } else if (type === 'EveryYear') {
                var sM = (dr.querySelector('.selStartMonth') || {}).value || '1';
                var sD = (dr.querySelector('.selStartDay') || {}).value || '1';
                var eM = (dr.querySelector('.selEndMonth') || {}).value || '1';
                var eD = (dr.querySelector('.selEndDay') || {}).value || '1';
                s = '2000-' + sM.padStart(2, '0') + '-' + sD.padStart(2, '0');
                e = '2000-' + eM.padStart(2, '0') + '-' + eD.padStart(2, '0');
            } else if (type === 'Weekly') {
                days = Array.from(dr.querySelectorAll('.day-toggle.active')).map(function(b) { return b.dataset.day; }).join(',');
            }
            intervals.push({ Type: type, Start: s, End: e, DayOfWeek: days });
        });
        return intervals;
    }

    function getSourceBadgeHtml(st) {
        var map = {
            'External':          { icon: 'language',        title: '外部列表' },
            'LocalCollection':   { icon: 'folder_special',  title: '本地合集' },
            'LocalPlaylist':     { icon: 'playlist_play',   title: '本地播放列表' },
            'MediaInfo':         { icon: 'tune',            title: '智能列表' },
                'AI':              { icon: 'auto_awesome',   title: 'AI 创建的列表' }
        };
        var e = map[st];
        if (!e) return '';
        return `<span class="tag-indicator source" title="${e.title}"><i class="md-icon" style="font-size:1.1em;">${e.icon}</i></span>`;
    }

    function renderTagGroup(tagConfig, container, prepend, index, isNew, afterRef) {
        var aiSourceProvider = tagConfig.AiProvider || (isNew ? selectedAnimeAiProvider() : 'OpenAI');
        var isChecked = tagConfig.Active !== false ? 'checked' : '';
        var tagName = tagConfig.Tag || '';
        var labelName = tagConfig.Name || '';
        var urls = tagConfig.Urls || (tagConfig.Url ? [{ url: tagConfig.Url, limit: tagConfig.Limit !== undefined ? tagConfig.Limit : 0 }] : [{ url: '', limit: 0 }]);
        var blacklist = migrateCommaSeparated((tagConfig.Blacklist || []).join('\n'));
        var intervals = tagConfig.ActiveIntervals || [];
        var idx = typeof index !== 'undefined' ? index : 9999;

        var lastMod = tagConfig.LastModified || new Date().toISOString();

        var enableTag = tagConfig.EnableTag !== false ? 'checked' : '';
        var enableColl = tagConfig.EnableCollection ? 'checked' : '';
        var enablePlaylist = tagConfig.EnablePlaylist ? 'checked' : '';
        var playlistName = tagConfig.PlaylistName || '';
        var playlistUserIds = tagConfig.PlaylistUserIds || [];
        var playlistUserIdsEnc = encodeURIComponent(JSON.stringify(playlistUserIds));
        var playlistMappingsEnc = encodeURIComponent(JSON.stringify(tagConfig.PlaylistMappings || []));
        var overrideChecked = tagConfig.OverrideWhenActive ? 'checked' : '';

        var collName = tagConfig.CollectionName || '';
        var collSortName = String(tagConfig.CollectionSortName || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        var collDescription = tagConfig.CollectionDescription || '';
        var collPosterPath = tagConfig.CollectionPosterPath || '';

        var sourceType = tagConfig.SourceType || "";
        var localSources = tagConfig.LocalSources || [];
        if (localSources.length === 0) localSources = [{ id: "", limit: 0 }];

        var mediaInfoLimit = tagConfig.Limit || 0;
        var aiLimit = tagConfig.Limit || 0;
        // Backwards compat: legacy single-target → derive separate tag + collection targets
        var _legacyTarget = tagConfig.MediaInfoTargetType || (tagConfig.MediaInfoSeasonMode ? 'Season' : '');
        // Tag output targets — default Series=true if no target has ever been set
        var _tagAnySet = tagConfig.TagTargetEpisode || tagConfig.TagTargetSeason || tagConfig.TagTargetSeries ||
                         tagConfig.MediaInfoTargetEpisode || tagConfig.MediaInfoTargetSeason || tagConfig.MediaInfoTargetSeries ||
                         _legacyTarget !== '';
        var _tagTargetEp  = tagConfig.TagTargetEpisode  || tagConfig.MediaInfoTargetEpisode || _legacyTarget === 'Episode';
        var _tagTargetSea = tagConfig.TagTargetSeason   || tagConfig.MediaInfoTargetSeason  || _legacyTarget === 'Season';
        var _tagTargetSer = tagConfig.TagTargetSeries   || tagConfig.MediaInfoTargetSeries  || _legacyTarget === 'Series' || !_tagAnySet;
        // Collection output targets — default Series=true if no target has ever been set
        var _collAnySet = tagConfig.CollectionTargetEpisode || tagConfig.CollectionTargetSeason || tagConfig.CollectionTargetSeries ||
                          tagConfig.MediaInfoTargetEpisode || tagConfig.MediaInfoTargetSeason || tagConfig.MediaInfoTargetSeries ||
                          _legacyTarget !== '';
        var _collTargetEp  = tagConfig.CollectionTargetEpisode || tagConfig.MediaInfoTargetEpisode || _legacyTarget === 'Episode';
        var _collTargetSea = tagConfig.CollectionTargetSeason  || tagConfig.MediaInfoTargetSeason  || _legacyTarget === 'Season';
        var _collTargetSer = tagConfig.CollectionTargetSeries  || tagConfig.MediaInfoTargetSeries  || _legacyTarget === 'Series' || !_collAnySet;

        var enableHomeSection = tagConfig.EnableHomeSection ? 'checked' : '';
        var disableHomeSection = (tagConfig.EnableTag === false && !tagConfig.EnableCollection) ? 'disabled' : '';
        var homeSectionLibraryId = encodeURIComponent(tagConfig.HomeSectionLibraryId || 'auto');
        var homeSectionUserIdsEnc = encodeURIComponent(JSON.stringify(tagConfig.HomeSectionUserIds || []));
        var homeSectionSettingsEnc = encodeURIComponent(tagConfig.HomeSectionSettings || '{}');
        var homeSectionTrackedEnc = encodeURIComponent(JSON.stringify(tagConfig.HomeSectionTracked || []));
        var hsDefaultSectionType = tagConfig.EnableCollection ? 'boxset' : (tagConfig.EnableTag ? 'items' : 'boxset');

        var mediaFilters = (tagConfig.MediaInfoFilters && tagConfig.MediaInfoFilters.length > 0)
            ? tagConfig.MediaInfoFilters
            : ((tagConfig.MediaInfoConditions && tagConfig.MediaInfoConditions.length > 0)
                ? [{ Operator: 'AND', Criteria: tagConfig.MediaInfoConditions }]
                : []);
        var filterGroupsHtml = mediaFilters.map((f, i) => getMediaInfoFilterGroupHtml(f, i, i === 0)).join('');

        var activeText = tagConfig.Active !== false ? "已启用" : "已禁用";
        var activeColor = tagConfig.Active !== false ? "#52B54B" : "var(--theme-text-secondary)";

        var sourceBadgeHtml = getSourceBadgeHtml(sourceType);
        var indicatorsHtml = '';
        if (intervals.length > 0) {
            var schedActiveClass = isScheduleCurrentlyActive(intervals) ? ' schedule-active' : '';
            var schedPriorityClass = tagConfig.OverrideWhenActive ? ' priority-active' : '';
            var schedText = tagConfig.OverrideWhenActive ? '计划优先' : '计划';
            indicatorsHtml += `<span class="tag-indicator schedule${schedPriorityClass}${schedActiveClass}"><i class="md-icon" style="font-size:1.1em;">calendar_today</i> ${schedText}</span>`;
        }
        if (tagConfig.EnableCollection) {
            indicatorsHtml += `<span class="tag-indicator collection"><i class="md-icon" style="font-size:1.1em;">library_books</i> 合集</span>`;
        }
        if (tagConfig.EnableHomeSection) {
            indicatorsHtml += `<span class="tag-indicator homescreen"><i class="md-icon" style="font-size:1.1em;">home</i> 主屏幕栏目</span>`;
        }
        if (tagConfig.EnableTag) {
            indicatorsHtml += `<span class="tag-indicator tag"><i class="md-icon" style="font-size:1.1em;">label</i> 标签</span>`;
        }
        if (tagConfig.EnablePlaylist) {
            indicatorsHtml += `<span class="tag-indicator playlist"><i class="md-icon" style="font-size:1.1em;">queue_music</i> 播放列表</span>`;
        }
        if (_topListTagNames.has(tagName.toLowerCase())) {
            indicatorsHtml += `<span class="tag-indicator toplist"><i class="md-icon" style="font-size:1.1em;">format_list_numbered</i> 榜单</span>`;
        }

        var initialStyle = isNew ? 'display:block;' : 'display:none;';
        var initialIcon = isNew ? 'expand_less' : 'expand_more';

        var inactiveClass = tagConfig.Active === false ? "inactive" : "";
        var newClass = isNew ? "just-added" : "";

        var html = `
        <div class="tag-row ${inactiveClass} ${newClass}" data-index="${idx}" data-tag="${tagName.toLowerCase()}" data-last-modified="${lastMod}" data-dirty="false">
            <div class="tag-header" style="display:flex; align-items:center; justify-content:space-between; padding:10px; cursor:pointer;">
                <div style="display:flex; align-items:center;">
                    <div class="header-actions" style="margin-right:15px; display:flex; align-items:center;" onclick="event.stopPropagation()">
                        <div class="drag-handle">
                            <i class="md-icon">reorder</i>
                        </div>
                        <span class="lblActiveStatus" style="margin-right:8px; font-size:0.9em; font-weight:bold; color:${activeColor}; min-width:60px; text-align:right;">${activeText}</span>
                        <label class="checkboxContainer" style="margin:0;">
                            <input type="checkbox" is="emby-checkbox" class="chkTagActive" ${isChecked} />
                            <span></span>
                        </label>
                    </div>
                    <div class="tag-info" style="display:flex; align-items:center;">
                        <span class="source-badge">${sourceBadgeHtml}</span>
                        <span class="tag-title" style="font-weight:bold; font-size:1.1em;">${labelName || tagName || '新建'}</span>
                        <span class="badge-container" style="display:flex; align-items:center;">${indicatorsHtml}</span>
                    </div>
                </div>
                <i class="md-icon expand-icon">${initialIcon}</i>
            </div>
            <div class="tag-body" style="${initialStyle} padding:15px; border-top:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex; justify-content:flex-end; margin-bottom:4px;">
                    <button type="button" is="emby-button" class="btnDuplicateRow raised" style="background:transparent; color:var(--theme-text-secondary); font-size:0.82em; padding:0 10px; min-width:0; box-shadow:none;" title="复制此来源"><i class="md-icon" style="font-size:1em; margin-right:4px;">content_copy</i><span>复制</span></button>
                </div>
                <div class="tag-tabs" style="display: flex; gap: 20px; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div class="tag-tab active" data-tab="general" style="padding: 8px 0; cursor: pointer; font-weight: bold; border-bottom: 2px solid #52B54B;">来源</div>
                    <div class="tag-tab" data-tab="tag" style="padding: 8px 0; cursor: pointer; opacity: 0.6; font-weight: bold; border-bottom: 2px solid transparent;">标签</div>
                    <div class="tag-tab" data-tab="collection" style="padding: 8px 0; cursor: pointer; opacity: 0.6; font-weight: bold; border-bottom: 2px solid transparent;">合集</div>
                    <div class="tag-tab" data-tab="playlist" style="padding: 8px 0; cursor: pointer; opacity: 0.6; font-weight: bold; border-bottom: 2px solid transparent;">播放列表</div>
                    <div class="tag-tab" data-tab="schedule" style="padding: 8px 0; cursor: pointer; opacity: 0.6; font-weight: bold; border-bottom: 2px solid transparent;">计划</div>
                    <div class="tag-tab" data-tab="advanced" style="padding: 8px 0; cursor: pointer; opacity: 0.6; font-weight: bold; border-bottom: 2px solid transparent;">黑名单</div>
                    <div class="tag-tab" data-tab="homescreen" style="padding: 8px 0; cursor: pointer; opacity: 0.6; font-weight: bold; border-bottom: 2px solid transparent;">主屏幕</div>
                </div>
                
                <div class="tab-content general-tab">
                    <div class="inputContainer" style="flex-grow:1;"><input is="emby-input" class="txtEntryLabel" type="text" label="显示名称" value="${labelName}" /></div>
                    
                    <div style="margin-bottom: 15px;">
                        <label class="selectLabel">来源类型</label>
                        <select is="emby-select" class="selSourceType" style="width:100%;">
                            <option value="" ${!sourceType ? 'selected' : ''}>-- 选择来源类型 --</option>
                            <option value="External" ${sourceType === 'External' ? 'selected' : ''}>外部列表 (Trakt/MDBList/TMDb)</option>
                            <option value="LocalCollection" ${sourceType === 'LocalCollection' ? 'selected' : ''}>本地合集</option>
                            <option value="LocalPlaylist" ${sourceType === 'LocalPlaylist' ? 'selected' : ''}>本地播放列表</option>
                            <option value="MediaInfo" ${sourceType === 'MediaInfo' ? 'selected' : ''}>本地媒体信息（智能列表）</option>
                            <option value="AI" ${sourceType === 'AI' ? 'selected' : ''}>AI 创建的列表</option>
                        </select>
                        <p class="source-type-hint" style="margin:6px 0 0 0; font-size:1em; opacity:0.8; line-height:1.4;">${(function(st) {
                            if (st === 'External')         return '使用外部列表，为媒体库中匹配的项目添加标签或创建合集。';
                            if (st === 'LocalCollection') return '为所选合集中的每个项目添加配置的标签，或将其加入新合集。也可将精选的合集列表设为主屏幕栏目。';
                            if (st === 'LocalPlaylist')   return '为所选播放列表中的每个项目添加配置的标签，或将其加入新合集。';
                            if (st === 'MediaInfo')       return '筛选自己的媒体库，选择要添加标签或创建合集的电影或剧集。这也称为智能列表。';
                            if (st === 'AI')              return '使用 AI 创建列表。输入提示词，AI 将据此生成列表。';
                            return '';
                        })(sourceType)}</p>
                    </div>

                    <div class="source-external-container" style="display: ${sourceType === 'External' ? 'block' : 'none'};">
                        <div style="display:flex; align-items:baseline; gap:10px; margin:10px 0 10px 0;">
                            <p style="margin:0; font-size:0.9em; font-weight:bold; opacity:0.7;">来源 URL</p>
                            <span style="font-size:0.75em; opacity:0.5;">— 查找列表：<a href="https://trakt.tv/discover" target="_blank" style="color:inherit; text-decoration:underline;">Trakt</a> &middot; <a href="https://mdblist.com/toplists/" target="_blank" style="color:inherit; text-decoration:underline;">MDBList</a> &middot; <a href="https://www.themoviedb.org/" target="_blank" style="color:inherit; text-decoration:underline;">TMDb</a> &middot; <a href="https://developer.themoviedb.org/reference/getting-started" target="_blank" style="color:inherit; text-decoration:underline;">TMDb API</a></span>
                        </div>
                        <div class="url-list-container">${urls.map(u => getUrlRowHtml(u.url, u.limit)).join('')}</div>
                        <div style="margin-top:10px;"><button is="emby-button" type="button" class="raised btnAddUrl" style="width:100%; background:transparent; border:2px dashed rgba(128,128,128,0.4); color:var(--theme-text-secondary);"><i class="md-icon" style="margin-right:5px;">add</i>添加另一个 URL</button></div>
                    </div>

                    <div class="source-local-container" style="display: ${(sourceType === 'LocalCollection' || sourceType === 'LocalPlaylist') ? 'block' : 'none'};">
                        <p style="margin:10px 0 10px 0; font-size:0.9em; font-weight:bold; opacity:0.7;" class="local-type-label">${sourceType === 'LocalPlaylist' ? '选择播放列表' : '选择合集'}</p>
                        <div class="local-list-container">${localSources.map(ls => getLocalRowHtml(sourceType, ls.id, ls.limit)).join('')}</div>
                        <div style="margin-top:10px;"><button is="emby-button" type="button" class="raised btnAddLocal" style="width:100%; background:transparent; border:2px dashed rgba(128,128,128,0.4); color:var(--theme-text-secondary);"><i class="md-icon" style="margin-right:5px;">add</i>再添加一个</button></div>
                    </div>

                    <div class="source-ai-container" style="display: ${sourceType === 'AI' ? 'block' : 'none'};">
                        <div style="margin-bottom: 15px;">
                            <label class="selectLabel">AI 提供商</label>
                            <select is="emby-select" class="selAiProvider" style="width:100%;">
                                <option value="OpenAICompatible" ${aiSourceProvider === 'OpenAICompatible' ? 'selected' : ''}>OpenAI 兼容接口</option>
                                <option value="OpenAI" ${aiSourceProvider === 'OpenAI' ? 'selected' : ''}>OpenAI (ChatGPT)</option>
                                <option value="Gemini" ${aiSourceProvider === 'Gemini' ? 'selected' : ''}>Google Gemini</option>
                                <option value="Claude" ${aiSourceProvider === 'Claude' ? 'selected' : ''}>Anthropic Claude</option>
                                <option value="Ollama" ${aiSourceProvider === 'Ollama' ? 'selected' : ''}>Ollama（本地）</option>
                            </select>
                        </div>

                        <div class="ollama-experimental-warning" style="display:${aiSourceProvider === 'Ollama' ? 'flex' : 'none'}; align-items:flex-start; gap:8px; background:rgba(232,168,56,0.1); border:1px solid rgba(232,168,56,0.35); border-radius:4px; padding:10px 12px; margin-bottom:15px; font-size:0.85em; line-height:1.5;">
                            <i class="md-icon" style="font-size:1.1em; color:#e8a838; flex-shrink:0; margin-top:1px;">warning</i>
                            <span style="opacity:0.85;"><strong>实验性功能：</strong>Ollama 支持目前处于实验阶段。本地模型可能返回不准确的 IMDB ID，插件会回退到标题匹配，但结果<strong>会</strong>因所用模型而异。本地 AI 的已知局限包括缺乏最新信息，以及在线检索能力有限。目前看来，云端模型是更好的选择。 </span>
                        </div>

                        <div class="inputContainer" style="margin-bottom:15px;">
                            <textarea is="emby-textarea" class="txtAiPrompt" rows="3"
                                label="提示词"
                                style="width:100%; resize:vertical; box-sizing:border-box;"
                                placeholder="例如：推荐 2000 年代的惊悚电影">${escapeHtml(tagConfig.AiPrompt || '')}</textarea>
                            <div class="fieldDescription">写下您的需求。系统会自动将输出整理为结构化的电影或剧集列表，无需指定格式。</div>
                        </div>

                        <div class="checkboxContainer checkboxContainer-withDescription" style="margin-top:12px;">
                            <label>
                                <input type="checkbox" is="emby-checkbox" class="chkAiRecentlyWatched" ${tagConfig.AiIncludeRecentlyWatched ? 'checked' : ''} />
                                <span>加入最近观看记录以提供个性化推荐</span>
                            </label>
                            <div class="fieldDescription">将所选用户的观看记录添加到 AI 提示词开头，以生成“为你推荐”类列表。</div>
                        </div>

                        <div class="ai-recently-watched-options" style="display: ${tagConfig.AiIncludeRecentlyWatched ? 'block' : 'none'}; margin-top:10px; padding-left:10px; border-left:2px solid rgba(128,128,128,0.3);">
                            <div style="margin-bottom:10px;">
                                <label class="selectLabel">观看记录所属用户</label>
                                <select is="emby-select" class="selAiWatchedUser" style="width:100%;">
                                    <option value="">-- 选择用户 --</option>
                                    ${(_miUsers || []).map(function(u) { return '<option value="' + u.Id + '"' + (u.Id === (tagConfig.AiRecentlyWatchedUserId || '') ? ' selected' : '') + '>' + u.Name + '</option>'; }).join('')}
                                </select>
                            </div>
                            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                                <label style="font-size:0.9em; white-space:nowrap; margin:0;">包含的最近观看项目数</label>
                                <input is="emby-input" class="txtAiWatchedCount" type="number" value="${tagConfig.AiRecentlyWatchedCount || 20}" min="5" max="100" style="width:80px;" />
                            </div>
                        </div>

                        <div style="display:flex; align-items:center; gap:12px; margin-top:15px; margin-bottom:15px;">
                            <label style="font-size:0.9em; white-space:nowrap; margin:0;">最大项目数</label>
                            <input is="emby-input" class="txtAiLimit" type="number" value="${aiLimit}" min="0" style="width:90px;" />
                            <span style="font-size:0.8em; opacity:0.5;">0 = 不限。自动加入提示词。</span>
                        </div>

                        <div style="display:flex; align-items:center; gap:12px; margin-top:0; margin-bottom:15px;">
                            <label style="font-size:0.9em; white-space:nowrap; margin:0;">刷新间隔</label>
                            <input is="emby-input" class="txtAiRefreshInterval" type="number" value="${tagConfig.AiRefreshIntervalDays || 0}" min="0" style="width:90px;" />
                            <span style="font-size:0.8em; opacity:0.5;">天 &nbsp;（0 = 每次完整同步时运行）</span>
                        </div>

                        <div style="margin-top:0;">
                            <button type="button" is="emby-button" class="raised btnTestAiSource btn-neutral" style="background:transparent; border:1px solid rgba(128,128,128,0.4); color:var(--theme-text-secondary);">
                                <i class="md-icon" style="margin-right:5px;">science</i>测试 AI 来源
                            </button>
                            <span class="ai-test-result" style="margin-left:10px; font-size:0.85em; opacity:0.7;"></span>
                        </div>
                    </div>

                    <div class="source-mediainfo-container" style="display: ${(sourceType && sourceType !== '') ? 'block' : 'none'};">
                        <div class="mi-limit-row" style="display:${sourceType === 'MediaInfo' ? 'flex' : 'none'}; align-items:center; gap:12px; margin-bottom:14px; flex-wrap:wrap;">
                            <label style="font-size:0.9em; white-space:nowrap; margin:0;">最大项目数</label>
                            <input is="emby-input" class="txtMediaInfoLimit" type="number" value="${mediaInfoLimit}" min="0" style="width:90px;" />
                            <button type="button" is="emby-button" class="btnMiHelp raised" style="margin-left:auto; background:transparent; border:1px solid rgba(128,128,128,0.35); color:var(--theme-text-secondary); font-size:0.82em; padding:0 10px; min-width:0;"><i class="md-icon" style="font-size:1em; margin-right:4px;">help_outline</i><span>使用方法（筛选指南）</span></button>
                        </div>
                        <div class="mi-toggle-row" style="display:${sourceType === 'MediaInfo' || mediaFilters.length > 0 ? 'none' : 'block'}; padding-top:14px; border-top:1px solid var(--line-color);">
                            <button type="button" is="emby-button" class="btnToggleAdditionalFilters raised" style="background:transparent; border:1px solid rgba(128,128,128,0.35); color:var(--theme-text-secondary); font-size:0.85em;"><i class="md-icon" style="font-size:1em; margin-right:4px;">filter_list</i><span>添加筛选条件（可选）</span></button>
                        </div>
                        <div class="mi-filter-body" style="display:${sourceType === 'MediaInfo' || mediaFilters.length > 0 ? 'block' : 'none'};">
                            <div class="mi-help-btn-row" style="display:${sourceType === 'MediaInfo' ? 'none' : 'flex'}; margin-bottom:14px; padding-top:14px; border-top:1px solid var(--line-color);">
                                <button type="button" is="emby-button" class="btnMiHelp raised" style="margin-left:auto; background:transparent; border:1px solid rgba(128,128,128,0.35); color:var(--theme-text-secondary); font-size:0.82em; padding:0 10px; min-width:0;"><i class="md-icon" style="font-size:1em; margin-right:4px;">help_outline</i><span>使用方法（筛选指南）</span></button>
                            </div>
                            <div class="mediainfo-filter-list">${filterGroupsHtml}</div>
                            <div style="display:flex; gap:8px; margin-top:8px;">
                                <button type="button" is="emby-button" class="btnAddMediaInfoFilter raised" style="flex:1; background:transparent; border:2px dashed rgba(128,128,128,0.4); color:var(--theme-text-secondary);"><i class="md-icon" style="margin-right:5px;">add</i>添加筛选组</button>
                                <button type="button" is="emby-button" class="btnClearAllFilters raised" style="background:transparent; border:2px dashed rgba(204,51,51,0.4); color:#cc3333; padding:0 14px; min-width:0;" title="清空所有筛选条件"><i class="md-icon" style="font-size:1em;">delete_sweep</i></button>
                            </div>
                            <div class="mi-presets-section" style="margin-top:30px; border-top:1px solid var(--line-color); padding-top:12px; display:${sourceType === 'MediaInfo' ? 'block' : 'none'};">
                            ${true ? `
                                <button type="button" is="emby-button" class="btnPremadeFilters raised btn-neutral" style="width:100%; margin-bottom:6px; background:transparent; border:1px solid var(--line-color); color:var(--theme-text-secondary); display:flex; align-items:center; justify-content:space-between;"><span><i class="md-icon" style="margin-right:5px;">auto_awesome</i>预设筛选条件</span><i class="md-icon mi-expand-icon" style="transition:transform 0.2s; font-size:1.2em;">expand_more</i></button>
                                <div class="mi-preset-panel" style="display:none; border:1px solid var(--line-color); border-radius:6px; padding:10px 12px; margin-bottom:8px; background:rgba(128,128,128,0.06);">
                                    <div style="font-size:0.8em; color:var(--theme-text-secondary); margin-bottom:10px;">选择预设以替换当前筛选条件：</div>
                                    ${MI_PRESETS.map(function(cat, ci) {
                                        return '<div style="margin-bottom:10px;">' +
                                            '<div style="font-size:0.72em; text-transform:uppercase; letter-spacing:1px; color:var(--theme-text-secondary); margin-bottom:5px;">' + cat.label + '</div>' +
                                            '<div style="display:flex; flex-wrap:wrap; gap:6px;">' +
                                            cat.presets.map(function(p, pi) {
                                                return '<button type="button" class="btnApplyMiPreset" data-preset="' + ci + ',' + pi + '"' +
                                                    ' style="border:1.5px solid #000; border-radius:14px; padding:4px 12px; font-size:0.82em; cursor:pointer; background:transparent; color:var(--theme-text-primary);">' + p.name + '</button>';
                                            }).join('') + '</div></div>';
                                    }).join('')}
                                </div>
                                <button type="button" is="emby-button" class="btnMySavedFilters raised btn-neutral" style="width:100%; margin-bottom:6px; background:transparent; border:1px solid var(--line-color); color:var(--theme-text-secondary); display:flex; align-items:center; justify-content:space-between;"><span><i class="md-icon" style="margin-right:5px;">bookmarks</i>我保存的筛选条件</span><i class="md-icon mi-expand-icon" style="transition:transform 0.2s; font-size:1.2em;">expand_more</i></button>
                                <div class="mi-saved-panel" style="display:none; border:1px solid var(--line-color); border-radius:6px; padding:10px 12px; margin-bottom:8px; background:rgba(128,128,128,0.06);">
                                    <div style="font-size:0.8em; color:var(--theme-text-secondary); margin-bottom:10px;">选择已保存的筛选条件以替换当前筛选条件：</div>
                                    <div class="mi-saved-panel-content">${getMySavedFiltersPanelHtml()}</div>
                                    <div style="border-top:1px solid var(--line-color); margin:12px 0 10px;"></div>
                                    <div style="font-size:0.8em; color:var(--theme-text-secondary); margin-bottom:6px;">将当前筛选条件另存为：</div>
                                    <div class="mi-saveas-bar" style="display:flex; gap:6px; align-items:flex-start;">
                                        <input type="text" class="txtSaveFilterName emby-input" placeholder="筛选条件名称..." style="flex:1; padding:4px 8px; font-size:0.85em;" />
                                        <button type="button" is="emby-button" class="btnConfirmSaveFilter raised" style="background:var(--button-background); color:var(--button-foreground); flex-shrink:0;">保存</button>
                                    </div>
                                </div>
                            ` : ''}
                            </div>
                        </div>
                    </div>

                </div>

            <div class="tab-content tagname-tab" style="display:none;">
                    <div class="inputContainer" style="flex-grow:1;"><input is="emby-input" class="txtTagName" type="text" label="标签名称" value="${tagName}" placeholder="${labelName}" /></div>
                    <div class="tag-tab-controls" style="margin-top:10px;">
                        <div class="checkboxContainer checkboxContainer-withDescription">
                            <label>
                                <input is="emby-checkbox" type="checkbox" class="chkEnableTag" ${enableTag} />
                                <span>应用标签</span>
                            </label>
                            <div class="fieldDescription">自动为 Emby 中匹配的项目添加标签。</div>
                        </div>
                        <div class="tag-settings" style="margin-left: 20px; padding-left: 15px; border-left: 2px solid var(--line-color); margin-top: 10px; display: ${tagConfig.EnableTag !== false ? 'block' : 'none'};">
                            <div class="mi-tag-target-section" style="margin-top:4px;">
                                <div style="font-size:0.85em; opacity:0.6; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
                                    <span>对于电视剧，选择添加标签的层级：</span>
                                    <button type="button" is="emby-button" class="btnTagTargetHelp raised" style="background:transparent; border:1px solid rgba(128,128,128,0.35); color:var(--theme-text-secondary); font-size:0.82em; padding:0 10px; min-width:0;"><i class="md-icon" style="font-size:1em; margin-right:4px;">help_outline</i><span>使用方法</span></button>
                                </div>
                                <div style="display:flex; flex-direction:row; align-items:center; gap:20px;">
                                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; white-space:nowrap;">
                                        <input type="checkbox" is="emby-checkbox" class="chkTagTargetSeries" ${_tagTargetSer ? 'checked' : ''} />
                                        <span>整部剧集</span>
                                    </label>
                                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; white-space:nowrap;">
                                        <input type="checkbox" is="emby-checkbox" class="chkTagTargetSeason" ${_tagTargetSea ? 'checked' : ''} />
                                        <span>季</span>
                                    </label>
                                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; white-space:nowrap;">
                                        <input type="checkbox" is="emby-checkbox" class="chkTagTargetEpisode" ${_tagTargetEp ? 'checked' : ''} />
                                        <span>单集</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
            </div>

                <div class="tab-content schedule-tab" style="display:none;">
                    <p style="margin:0 0 15px 0; font-size:0.9em; opacity:0.8;">设置此标签的生效时间。留空则始终生效。</p>
                    <div class="date-list-container">${intervals.map(i => getDateRowHtml(i)).join('')}</div>
                    <button is="emby-button" type="button" class="btnAddDate" style="width:100%; background:transparent; border:2px dashed rgba(128,128,128,0.4); color:var(--theme-text-secondary); margin-top:10px;"><i class="md-icon" style="margin-right:5px;">event</i>添加计划规则</button>
                    <div class="checkboxContainer checkboxContainer-withDescription" style="margin-top:16px; ${intervals.length === 0 ? 'opacity:0.4;' : ''}">
                        <label>
                            <input is="emby-checkbox" type="checkbox" class="chkOverrideWhenActive" ${overrideChecked} ${intervals.length === 0 ? 'disabled' : ''} />
                            <span>生效时优先覆盖</span>
                        </label>
                        <div class="fieldDescription">此分组处于计划生效时间内时，使用相同标签或合集的其他分组会暂停生效，只有此分组的项目保留该标签和合集。</div>
                    </div>
                </div>

                <div class="tab-content collection-tab" style="display:none;">
                    <div class="collection-tab-controls">
                    <div class="checkboxContainer checkboxContainer-withDescription">
                        <label>
                            <input is="emby-checkbox" type="checkbox" class="chkEnableCollection" ${enableColl} />
                            <span>创建合集</span>
                        </label>
                        <div class="fieldDescription">根据这些项目自动创建并维护 Emby 合集。</div>
                    </div>
                    
                    <div class="collection-settings" style="margin-left: 20px; padding-left: 15px; border-left: 2px solid var(--line-color); margin-top: 10px; display: ${tagConfig.EnableCollection ? 'block' : 'none'};">
                        <div class="inputContainer">
                            <input is="emby-input" type="text" class="txtCollectionName" label="合集名称" value="${collName}" placeholder="${labelName}" />
                            <div class="fieldDescription">留空则使用显示名称。</div>
                        </div>

                        <div class="inputContainer">
                            <input is="emby-input" type="text" class="txtCollectionSortName" label="排序标题" value="${collSortName}" />
                            <div class="fieldDescription">可选。按名称排序合集时，用此值代替名称，例如使用“001”可将此合集排在最前。留空则按合集名称排序。</div>
                        </div>

                        <div class="mi-coll-target-section" style="margin-top:10px;">
                            <div style="font-size:0.85em; opacity:0.6; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
                                <span>对于电视剧，选择加入合集的层级：</span>
                                <button type="button" is="emby-button" class="btnCollTargetHelp raised" style="background:transparent; border:1px solid rgba(128,128,128,0.35); color:var(--theme-text-secondary); font-size:0.82em; padding:0 10px; min-width:0;"><i class="md-icon" style="font-size:1em; margin-right:4px;">help_outline</i><span>使用方法</span></button>
                            </div>
                            <div style="display:flex; flex-direction:row; align-items:center; gap:20px;">
                                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; white-space:nowrap;">
                                    <input type="checkbox" is="emby-checkbox" class="chkCollTargetSeries" ${_collTargetSer ? 'checked' : ''} />
                                    <span>整部剧集</span>
                                </label>
                                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; white-space:nowrap;">
                                    <input type="checkbox" is="emby-checkbox" class="chkCollTargetSeason" ${_collTargetSea ? 'checked' : ''} />
                                    <span>季</span>
                                </label>
                                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; white-space:nowrap;">
                                    <input type="checkbox" is="emby-checkbox" class="chkCollTargetEpisode" ${_collTargetEp ? 'checked' : ''} />
                                    <span>单集</span>
                                </label>
                            </div>
                        </div>

                        <div class="inputContainer" style="margin-top:15px;">
                            <textarea is="emby-textarea" class="txtCollectionDescription" rows="3"
                                label="简介"
                                placeholder="此合集的简介（可选）..."
                                style="width:100%; resize:vertical; box-sizing:border-box;">${collDescription}</textarea>
                        </div>

                        <div style="margin-top:15px;">
                            <p style="margin:0 0 8px 0; font-size:0.9em; font-weight:bold; opacity:0.7;">合集海报</p>
                            <div class="poster-preview-container" style="margin-bottom:8px; display:${collPosterPath ? 'block' : 'none'};">
                                <span class="poster-filename" style="font-size:0.85em; opacity:0.7;">${collPosterPath ? collPosterPath.split(/[\\\\/]/).pop() : ''}</span>
                                <button type="button" class="btnRemovePoster" style="margin-left:10px; font-size:0.8em; background:transparent; border:none; color:#e55; cursor:pointer; vertical-align:middle;">✕ 移除</button>
                            </div>
                            <img class="poster-preview-img" src="" alt="" style="max-width:120px; max-height:180px; border-radius:4px; display:none; margin-bottom:8px;" />
                            <input type="file" class="inputPosterFile" accept="image/*" style="display:none;" />
                            <input type="hidden" class="hiddenPosterPath" value="${collPosterPath}" />
                            <button type="button" is="emby-button" class="btnChoosePoster raised" style="width:100%; background:transparent; border:2px dashed rgba(128,128,128,0.4); color:var(--theme-text-secondary);">
                                <i class="md-icon" style="margin-right:5px;">image</i>选择海报图片
                            </button>
                            <div style="display:flex; align-items:center; gap:6px; margin-top:8px; opacity:0.45;">
                                <div style="flex:1; height:1px; background:currentColor;"></div>
                                <span style="font-size:0.75em;">或</span>
                                <div style="flex:1; height:1px; background:currentColor;"></div>
                            </div>
                            <div style="display:flex; gap:6px; margin-top:6px;">
                                <input class="txtPosterUrl" is="emby-input" type="url" placeholder="https://example.com/poster.jpg" style="flex:1;" />
                                <button type="button" is="emby-button" class="btnLoadPosterUrl raised btn-neutral">加载</button>
                            </div>
                        </div>
                    </div>
                    </div>
                </div>

                <div class="tab-content playlist-tab" style="display:none;"
                    data-pl-userids="${playlistUserIdsEnc}"
                    data-pl-mappings="${playlistMappingsEnc}"
                    data-pl-loaded="0">
                    <div class="checkboxContainer checkboxContainer-withDescription">
                        <label>
                            <input is="emby-checkbox" type="checkbox" class="chkEnablePlaylist" ${enablePlaylist} />
                            <span>创建播放列表</span>
                        </label>
                        <div class="fieldDescription">为每位所选用户自动创建并维护独立的 Emby 播放列表。</div>
                    </div>
                    <div class="playlist-settings" style="margin-left: 20px; padding-left: 15px; border-left: 2px solid var(--line-color); margin-top: 10px; display: ${tagConfig.EnablePlaylist ? 'block' : 'none'};">
                        <div class="inputContainer">
                            <input is="emby-input" type="text" class="txtPlaylistName" label="播放列表名称" value="${playlistName}" placeholder="${labelName}" />
                            <div class="fieldDescription">留空则使用显示名称。</div>
                        </div>
                        <div style="margin-top:12px;">
                            <p style="margin:0 0 8px 0; font-size:0.9em; font-weight:bold; opacity:0.7;">目标用户</p>
                            <div class="playlist-user-list"><em style="opacity:0.5">正在加载用户...</em></div>
                        </div>
                    </div>
                </div>

                <div class="tab-content advanced-tab" style="display:none;">
                    <div class="inputContainer">
                        <p style="margin:0 0 5px 0; font-size:0.9em; font-weight:bold; opacity:0.7;">黑名单 / 忽略（IMDB ID）</p>
                        <textarea class="txtTagBlacklist" rows="2" placeholder="tt&lt;作品ID&gt;&#10;tt&lt;另一作品ID&gt;" style="width:100%;resize:none;overflow:hidden;padding:6px 8px;font-size:inherit;font-family:inherit;background:var(--plugin-input-bg,rgba(255,255,255,0.08));border:1px solid var(--plugin-input-border,rgba(255,255,255,0.2));border-radius:3px;color:inherit;line-height:1.4;min-height:44px;max-height:120px;overflow-y:auto;">${blacklist}</textarea>
                        <div class="fieldDescription">具有这些 ID 的项目不会被添加标签或加入合集。</div>
                    </div>
                </div>

                <div class="tab-content homescreen-tab" style="display:none;"
                    data-hse-libraryid="${homeSectionLibraryId}"
                    data-hse-userids="${homeSectionUserIdsEnc}"
                    data-hse-settings="${homeSectionSettingsEnc}"
                    data-hse-tracked="${homeSectionTrackedEnc}"
                    data-hse-default-type="${hsDefaultSectionType}"
                    data-hse-loaded="0">
                    <div class="checkboxContainer checkboxContainer-withDescription">
                        <label>
                            <input is="emby-checkbox" class="chkEnableHomeSection" type="checkbox" ${enableHomeSection} ${disableHomeSection}/>
                            <span>添加为主屏幕栏目</span>
                        </label>
                        <div class="fieldDescription">每次同步时，都会为所选用户管理一个主屏幕栏目。</div>
                        <div class="hse-disabled-hint" style="font-size:0.9em; color:#e07070; margin-top:4px; display:${(tagConfig.EnableTag === false && !tagConfig.EnableCollection) ? 'block' : 'none'};">需要启用<strong>应用标签</strong>或<strong>创建合集</strong>。</div>
                    </div>
                    <div class="hse-details" style="display:${enableHomeSection ? 'block' : 'none'}; margin-top:15px;">
                        <div style="margin-bottom:15px;">
                            <p style="margin:0 0 8px 0; font-size:0.9em; font-weight:bold; opacity:0.7;">目标用户</p>
                            <div class="hse-user-list-inner"><em style="opacity:0.5">正在加载用户...</em></div>
                        </div>
                        <div>
                            <p style="margin:0 0 8px 0; font-size:0.9em; font-weight:bold; opacity:0.7;">栏目设置</p>
                            <div class="hse-fields-inner"><em style="opacity:0.5">正在加载设置...</em></div>
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; align-items:center; gap:8px; margin-top:20px; border-top:1px solid var(--line-color); padding-top:10px;">
                    <button is="emby-button" type="button" class="raised button-submit btnRunEntry" style="background:#0099d5 !important; color:#fff !important;"><i class="md-icon" style="margin-right:5px;">play_arrow</i><span class="btnRunEntryLabel">运行分组</span></button>
                    <button is="emby-button" type="button" class="raised btnRemoveGroup" style="background:#cc3333 !important; color:#fff;"><i class="md-icon" style="margin-right:5px;">delete</i>移除分组</button>
                </div>
            </div>
        </div>`;

        if (afterRef) afterRef.insertAdjacentHTML('afterend', html);
        else if (prepend) container.insertAdjacentHTML('afterbegin', html);
        else container.insertAdjacentHTML('beforeend', html);

        var newRow = afterRef ? afterRef.nextElementSibling : (prepend ? container.firstElementChild : container.lastElementChild);
        setupRowEvents(newRow);
        // Auto-size any pre-filled growing textareas
        newRow.querySelectorAll('textarea.txtMiValue, textarea.txtTagBlacklist').forEach(function (ta) {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
            ta.style.overflowY = ta.scrollHeight > 120 ? 'auto' : 'hidden';
        });

        if (isNew) {
            setTimeout(() => { newRow.classList.remove('just-added'); }, 2000);
        }
    }

    function refreshTopListBadges() {
        document.querySelectorAll('.tag-row').forEach(function (row) {
            var container = row.querySelector('.badge-container');
            if (!container) return;
            var tagName = (row.dataset.tag || '').toLowerCase();
            var existing = container.querySelector('.tag-indicator.toplist');
            if (_topListTagNames.has(tagName)) {
                if (!existing) {
                    var span = document.createElement('span');
                    span.className = 'tag-indicator toplist';
                    span.innerHTML = '<i class="md-icon" style="font-size:1.1em;">format_list_numbered</i> 榜单';
                    container.appendChild(span);
                }
            } else if (existing) {
                existing.remove();
            }
        });
    }

    function setupRowEvents(row) {
        function updateBadges(row) {
            var container = row.querySelector('.badge-container');
            if (!container) return;

            var hasSchedule = row.querySelectorAll('.date-row').length > 0;
            var hasCollection = row.querySelector('.chkEnableCollection').checked;
            var hasHomeSection = row.querySelector('.chkEnableHomeSection').checked;
            var hasTag = row.querySelector('.chkEnableTag').checked;
            var hasPlaylist = !!(row.querySelector('.chkEnablePlaylist') || {}).checked;
            var overrideChk = row.querySelector('.chkOverrideWhenActive');
            if (overrideChk) {
                overrideChk.disabled = !hasSchedule;
                if (!hasSchedule) overrideChk.checked = false;
                var overrideContainer = overrideChk.closest('.checkboxContainer');
                if (overrideContainer) overrideContainer.style.opacity = hasSchedule ? '' : '0.4';
            }
            var hasOverride = hasSchedule && !!(overrideChk || {}).checked;

            var sourceBadge = row.querySelector('.source-badge');
            if (sourceBadge) sourceBadge.innerHTML = getSourceBadgeHtml(row.querySelector('.selSourceType').value);

            var html = '';
            if (hasSchedule) {
                var schedPriorityClass = hasOverride ? ' priority-active' : '';
                var schedActiveClass = isScheduleCurrentlyActive(readIntervalsFromRow(row)) ? ' schedule-active' : '';
                var schedText = hasOverride ? '计划优先' : '计划';
                html += `<span class="tag-indicator schedule${schedPriorityClass}${schedActiveClass}"><i class="md-icon" style="font-size:1.1em;">calendar_today</i> ${schedText}</span>`;
            }
            if (hasCollection) {
                html += `<span class="tag-indicator collection"><i class="md-icon" style="font-size:1.1em;">library_books</i> 合集</span>`;
            }
            if (hasHomeSection) {
                html += `<span class="tag-indicator homescreen"><i class="md-icon" style="font-size:1.1em;">home</i> 主屏幕栏目</span>`;
            }
            if (hasTag) {
                html += `<span class="tag-indicator tag"><i class="md-icon" style="font-size:1.1em;">label</i> 标签</span>`;
            }
            if (hasPlaylist) {
                html += `<span class="tag-indicator playlist"><i class="md-icon" style="font-size:1.1em;">queue_music</i> 播放列表</span>`;
            }
            if (_topListTagNames.has((row.dataset.tag || '').toLowerCase())) {
                html += `<span class="tag-indicator toplist"><i class="md-icon" style="font-size:1.1em;">format_list_numbered</i> 榜单</span>`;
            }
            container.innerHTML = html;
        }

        row.querySelectorAll('.tag-tab').forEach(tab => {
            tab.addEventListener('click', function () {
                row.querySelectorAll('.tag-tab').forEach(t => { t.style.opacity = "0.6"; t.style.borderBottomColor = "transparent"; });
                this.style.opacity = "1"; this.style.borderBottomColor = "#52B54B";
                var target = this.getAttribute('data-tab');
                row.querySelector('.general-tab').style.display = target === 'general' ? 'block' : 'none';
                row.querySelector('.tagname-tab').style.display = target === 'tag' ? 'block' : 'none';
                row.querySelector('.schedule-tab').style.display = target === 'schedule' ? 'block' : 'none';
                row.querySelector('.collection-tab').style.display = target === 'collection' ? 'block' : 'none';
                row.querySelector('.advanced-tab').style.display = target === 'advanced' ? 'block' : 'none';
                row.querySelector('.homescreen-tab').style.display = target === 'homescreen' ? 'block' : 'none';
                row.querySelector('.playlist-tab').style.display = target === 'playlist' ? 'block' : 'none';
                if (target === 'homescreen') initHomeSectionTab(row);
                if (target === 'playlist') initPlaylistTab(row);
                var activeTabEl = row.querySelector('.' + target + '-tab');
                if (activeTabEl) activeTabEl.querySelectorAll('textarea.txtMiValue, textarea.txtTagBlacklist').forEach(function(ta) {
                    ta.style.height = 'auto';
                    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
                    ta.style.overflowY = ta.scrollHeight > 120 ? 'auto' : 'hidden';
                });
            });
        });

        row.addEventListener('change', e => {
            if (e.target.classList.contains('selSourceType')) {
                var type = e.target.value;
                row.querySelector('.source-external-container').style.display = type === 'External' ? 'block' : 'none';
                row.querySelector('.source-local-container').style.display = (type === 'LocalCollection' || type === 'LocalPlaylist') ? 'block' : 'none';
                row.querySelector('.source-mediainfo-container').style.display = (type && type !== '') ? 'block' : 'none';
                row.querySelector('.source-ai-container').style.display = type === 'AI' ? 'block' : 'none';

                var _hint = row.querySelector('.source-type-hint');
                if (_hint) {
                    var _hints = {
                        'External':         '使用外部列表，为媒体库中匹配的项目添加标签或创建合集。',
                        'LocalCollection':  '为所选合集中的每个项目添加指定标签，或将其加入新合集。也可将精选的合集列表设为主屏幕栏目。',
                        'LocalPlaylist':    '为所选播放列表中的每个项目添加指定标签，或将其加入新合集。',
                        'MediaInfo':        '筛选自己的媒体库，选择要添加标签或创建合集的电影或剧集。此功能也称为智能列表。',
                        'AI':               '使用 AI 创建列表。输入提示词，AI 将据此生成列表。'
                    };
                    _hint.textContent = _hints[type] || '';
                }

                var isMi = type === 'MediaInfo';
                var miLimitRow      = row.querySelector('.mi-limit-row');
                var miToggleRow     = row.querySelector('.mi-toggle-row');
                var miFilterBody    = row.querySelector('.mi-filter-body');
                var miHelpBtnRow    = row.querySelector('.mi-help-btn-row');
                var miPresetsSection = row.querySelector('.mi-presets-section');
                if (miPresetsSection) miPresetsSection.style.display = isMi ? 'block' : 'none';
                if (miLimitRow) miLimitRow.style.display = isMi ? 'flex' : 'none';
                if (miHelpBtnRow) miHelpBtnRow.style.display = isMi ? 'none' : 'flex';
                if (isMi) {
                    if (miToggleRow)  miToggleRow.style.display  = 'none';
                    if (miFilterBody) miFilterBody.style.display = 'block';
                } else if (type) {
                    // Always collapse filters when switching away from MediaInfo — user must open manually
                    if (miToggleRow)  miToggleRow.style.display  = 'block';
                    if (miFilterBody) miFilterBody.style.display = 'none';
                }
                if (type) {
                    var miList = row.querySelector('.mediainfo-filter-list');
                    if (miList && isMi && miList.querySelectorAll('.mediainfo-filter-group').length === 0) {
                        miList.insertAdjacentHTML('beforeend', getMediaInfoFilterGroupHtml({ Operator: 'AND', Criteria: [], GroupOperator: 'AND' }, 0, true));
                    }
                }

                if (type === 'LocalCollection' || type === 'LocalPlaylist') {
                    row.querySelector('.local-list-container').innerHTML = getLocalRowHtml(type, "", 0);
                    row.querySelector('.local-type-label').textContent = type === 'LocalPlaylist' ? "选择播放列表" : "选择合集";
                }
                updateBadges(row);
            }
            
            if (e.target.classList.contains('selMiProperty')) {
                var miRule = e.target.closest('.mi-rule');
                miRule.querySelector('.mi-value-wrapper').innerHTML = getMiValueHtml(e.target.value, '', '');
                var existingHint = miRule.querySelector('.mi-rule-hint');
                if (existingHint) existingHint.outerHTML = getMiHintHtml(e.target.value);
            }
            if (e.target.classList.contains('selMiValue')) {
                var _miRule = e.target.closest('.mi-rule');
                if (_miRule) {
                    var _prop = (_miRule.querySelector('.selMiProperty') || {}).value;
                    if (_prop === 'MediaType') {
                        var _incParent = _miRule.querySelector('.mi-include-parent');
                        if (_incParent) _incParent.style.display = e.target.value === 'Episode' ? 'inline-flex' : 'none';
                    }
                }
            }
            if (e.target.classList.contains('selDateType')) {
                var dateRow = e.target.closest('.date-row');
                var type = e.target.value;
                dateRow.querySelector('.inputs-specific').style.display = type === 'SpecificDate' ? 'flex' : 'none';
                dateRow.querySelector('.inputs-annual').style.display = type === 'EveryYear' ? 'flex' : 'none';
                dateRow.querySelector('.inputs-weekly').style.display = type === 'Weekly' ? 'flex' : 'none';
            }
            if (e.target.classList.contains('selStartMonth') || e.target.classList.contains('selEndMonth')) {
                var isStart = e.target.classList.contains('selStartMonth');
                var dateRow = e.target.closest('.date-row');
                var month = parseInt(e.target.value, 10);
                var maxDay = getMaxDays(month);
                var daySelect = dateRow.querySelector(isStart ? '.selStartDay' : '.selEndDay');
                var currentDay = Math.min(parseInt(daySelect.value, 10), maxDay);
                daySelect.innerHTML = getDayOptions(currentDay, maxDay);
            }
            setTimeout(checkFormState, 0);
        });

        var header = row.querySelector('.tag-header'), body = row.querySelector('.tag-body'), icon = row.querySelector('.expand-icon');
        header.addEventListener('click', e => {
            if (e.target.closest('.header-actions')) return;
            var isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'block' : 'none';
            icon.innerText = isHidden ? 'expand_less' : 'expand_more';
            if (isHidden) {
                body.querySelectorAll('textarea.txtMiValue, textarea.txtTagBlacklist').forEach(function(ta) {
                    ta.style.height = 'auto';
                    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
                    ta.style.overflowY = ta.scrollHeight > 120 ? 'auto' : 'hidden';
                });
            }
        });

        var chk = row.querySelector('.chkTagActive'), lblStatus = row.querySelector('.lblActiveStatus');
        function updateRunGroupBtn() {
            var runBtn = row.querySelector('.btnRunEntry');
            if (!runBtn) return;
            var active = chk.checked;
            runBtn.disabled = !active;
            runBtn.style.opacity = active ? '1' : '0.4';
        }
        chk.addEventListener('change', function () {
            lblStatus.textContent = this.checked ? "已启用" : "已禁用";
            lblStatus.style.color = this.checked ? "#52B54B" : "var(--theme-text-secondary)";
            if (this.checked) row.classList.remove('inactive');
            else row.classList.add('inactive');
            updateRunGroupBtn();
        });
        updateRunGroupBtn();

        row.querySelector('.chkEnableTag').addEventListener('change', function () {
            row.querySelector('.tag-settings').style.display = this.checked ? 'block' : 'none';
            updateBadges(row);
            updateHseSectionAvailability(row);
        });

        row.querySelector('.chkEnableCollection').addEventListener('change', function () {
            row.querySelector('.collection-settings').style.display = this.checked ? 'block' : 'none';
            updateBadges(row);
            updateHseSectionAvailability(row);
        });

        row.querySelector('.chkEnablePlaylist').addEventListener('change', function () {
            row.querySelector('.playlist-settings').style.display = this.checked ? 'block' : 'none';
            updateBadges(row);
        });

        row.querySelector('.chkOverrideWhenActive').addEventListener('change', function () {
            updateBadges(row);
        });

        row.querySelector('.chkEnableHomeSection').addEventListener('change', function () {
            var hseDetails = row.querySelector('.hse-details');
            if (hseDetails) hseDetails.style.display = this.checked ? 'block' : 'none';
            updateBadges(row);
        });

        var chkAiWatched = row.querySelector('.chkAiRecentlyWatched');
        if (chkAiWatched) {
            chkAiWatched.addEventListener('change', function () {
                var opts = row.querySelector('.ai-recently-watched-options');
                if (opts) opts.style.display = this.checked ? 'block' : 'none';
            });
        }

        var selAiProv = row.querySelector('.selAiProvider');
        if (selAiProv) {
            selAiProv.addEventListener('change', function () {
                var warn = row.querySelector('.ollama-experimental-warning');
                if (warn) warn.style.display = this.value === 'Ollama' ? 'flex' : 'none';
            });
        }

        row.querySelector('.btnAddUrl').addEventListener('click', () => {
            row.querySelector('.url-list-container').insertAdjacentHTML('beforeend', getUrlRowHtml('', 0));
        });

        row.querySelector('.btnAddLocal').addEventListener('click', () => {
            var st = row.querySelector('.selSourceType').value;
            row.querySelector('.local-list-container').insertAdjacentHTML('beforeend', getLocalRowHtml(st, "", 0));
        });

        row.querySelector('.btnAddDate').addEventListener('click', () => {
            row.querySelector('.date-list-container').insertAdjacentHTML('beforeend', getDateRowHtml({ Type: 'SpecificDate' }));
            updateBadges(row);
        });

        row.querySelector('.btnTagTargetHelp').addEventListener('click', () => {
            document.getElementById('tagTargetHelpModalOverlay').classList.add('modal-visible');
        });

        row.querySelector('.btnCollTargetHelp').addEventListener('click', () => {
            document.getElementById('tagTargetHelpModalOverlay').classList.add('modal-visible');
        });

        row.addEventListener('click', e => {
            if (e.target.closest('.btnMiHelp')) {
                document.getElementById('miHelpModalOverlay').classList.add('modal-visible');
                return;
            }
            if (e.target.closest('.btnToggleAdditionalFilters')) {
                row.querySelector('.mi-toggle-row').style.display  = 'none';
                row.querySelector('.mi-filter-body').style.display = 'block';
                var miList = row.querySelector('.mediainfo-filter-list');
                if (miList && miList.querySelectorAll('.mediainfo-filter-group').length === 0) {
                    miList.insertAdjacentHTML('beforeend', getMediaInfoFilterGroupHtml({ Operator: 'AND', Criteria: [], GroupOperator: 'AND' }, 0, true));
                }
                return;
            }
            if (e.target.closest('.btnRemoveUrl')) {
                e.target.closest('.url-row').remove();
            }

            if (e.target.closest('.btnRemoveLocal')) {
                e.target.closest('.local-row').remove();
            }

            if (e.target.closest('.btnRemoveDate')) {
                e.target.closest('.date-row').remove();
                updateBadges(row);
            }

            if (e.target.closest('.btnPremadeFilters')) {
                var btn = e.target.closest('.btnPremadeFilters');
                var panel = btn.closest('.source-mediainfo-container').querySelector('.mi-preset-panel');
                var open = panel.style.display === 'none';
                panel.style.display = open ? '' : 'none';
                var icon = btn.querySelector('.mi-expand-icon');
                if (icon) icon.style.transform = open ? 'rotate(180deg)' : '';
                return;
            }
            if (e.target.closest('.btnMySavedFilters')) {
                var btn = e.target.closest('.btnMySavedFilters');
                var savedPanel = btn.closest('.source-mediainfo-container').querySelector('.mi-saved-panel');
                var open = savedPanel.style.display === 'none';
                savedPanel.style.display = open ? '' : 'none';
                var icon = btn.querySelector('.mi-expand-icon');
                if (icon) icon.style.transform = open ? 'rotate(180deg)' : '';
                return;
            }
            if (e.target.closest('.btnConfirmSaveFilter')) {
                var miContainer = e.target.closest('.source-mediainfo-container');
                var nameInput = miContainer.querySelector('.txtSaveFilterName');
                var name = nameInput.value.trim();
                if (!name) { nameInput.focus(); return; }
                var filters = readMiFiltersFromContainer(miContainer);
                if (filters.length === 0) { nameInput.focus(); return; }
                savedFilters.push({ Name: name, Filters: filters });
                nameInput.value = '';
                refreshMySavedFiltersPanels();
                saveSavedFiltersNow();
                return;
            }
            if (e.target.closest('.btnApplyMySavedFilter')) {
                var idx = parseInt(e.target.closest('.btnApplyMySavedFilter').dataset.index, 10);
                var sf = savedFilters[idx];
                var savedList = e.target.closest('.source-mediainfo-container').querySelector('.mediainfo-filter-list');
                savedList.innerHTML = sf.Filters.map(function(f, i) { return getMediaInfoFilterGroupHtml(f, i, i === 0); }).join('');
                e.target.closest('.mi-saved-panel').style.display = 'none';
                setTimeout(checkFormState, 0);
                return;
            }
            if (e.target.closest('.btnDeleteMySavedFilter')) {
                var idx = parseInt(e.target.closest('.btnDeleteMySavedFilter').dataset.index, 10);
                savedFilters.splice(idx, 1);
                refreshMySavedFiltersPanels();
                saveSavedFiltersNow();
                return;
            }
            if (e.target.closest('.btnApplyMiPreset')) {
                var idxParts = e.target.closest('.btnApplyMiPreset').dataset.preset.split(',');
                var preset = MI_PRESETS[+idxParts[0]].presets[+idxParts[1]];
                var presetFilters = preset.build();
                var presetList = e.target.closest('.source-mediainfo-container').querySelector('.mediainfo-filter-list');
                presetList.innerHTML = presetFilters.map(function(f, i) { return getMediaInfoFilterGroupHtml(f, i, i === 0); }).join('');
                e.target.closest('.mi-preset-panel').style.display = 'none';
                setTimeout(checkFormState, 0);
                return;
            }
            if (e.target.closest('.btnAddMediaInfoFilter')) {
                var list = row.querySelector('.mediainfo-filter-list');
                var idx = list.querySelectorAll('.mediainfo-filter-group').length;
                list.insertAdjacentHTML('beforeend', getMediaInfoFilterGroupHtml({ Operator: 'AND', Criteria: [], GroupOperator: 'AND' }, idx, false));
            }

            if (e.target.closest('.btnClearAllFilters')) {
                var list = row.querySelector('.mediainfo-filter-list');
                if (list) { list.innerHTML = ''; }
            }

            if (e.target.closest('.btnRemoveFilterGroup')) {
                e.target.closest('.mediainfo-filter-group').remove();
                var miList = row.querySelector('.mediainfo-filter-list');
                var firstGroup = miList && miList.querySelector('.mediainfo-filter-group');
                if (firstGroup) { var conn = firstGroup.querySelector('.mi-group-connector'); if (conn) conn.remove(); }
            }

            if (e.target.closest('.btnGroupOpChoice')) {
                var btn = e.target.closest('.btnGroupOpChoice');
                var newOp = btn.dataset.value;
                var group = btn.closest('.mediainfo-filter-group');
                group.dataset.groupOp = newOp;
                group.querySelectorAll('.btnGroupOpChoice').forEach(function(b) {
                    var active = b.dataset.value === newOp;
                    b.style.background = active
                        ? (newOp === 'AND' ? 'rgba(0,164,220,0.75)' : 'rgba(220,120,0,0.75)')
                        : 'transparent';
                    b.style.color = active ? '#fff' : '';
                });
                var desc = group.querySelector('.group-op-desc');
                if (desc) desc.textContent = newOp === 'AND' ? '两组都必须匹配' : '任一组匹配即可';
                setTimeout(checkFormState, 0);
            }

            if (e.target.closest('.btnGroupInnerOpChoice')) {
                var btn = e.target.closest('.btnGroupInnerOpChoice');
                var newOp = btn.dataset.value;
                var group = btn.closest('.mediainfo-filter-group');
                group.dataset.op = newOp;
                group.querySelectorAll('.btnGroupInnerOpChoice').forEach(function(b) {
                    var active = b.dataset.value === newOp;
                    b.style.background = active
                        ? (newOp === 'AND' ? 'rgba(0,164,220,0.75)' : 'rgba(220,120,0,0.75)')
                        : 'transparent';
                    b.style.color = active ? '#fff' : '';
                });
                var desc = group.querySelector('.inner-op-desc');
                if (desc) desc.textContent = newOp === 'AND' ? '所有规则都必须匹配' : '任一规则匹配即可';
                setTimeout(checkFormState, 0);
            }

            if (e.target.closest('.btnNotToggle')) {
                var btn = e.target.closest('.btnNotToggle');
                var active = btn.dataset.not === '1';
                active = !active;
                btn.dataset.not = active ? '1' : '0';
                btn.style.background = active ? 'rgba(200,50,50,0.75)' : 'transparent';
                btn.style.color = active ? '#fff' : '';
                btn.style.border = active ? '1px solid rgba(200,50,50,0.6)' : '1px solid rgba(128,128,128,0.4)';
                setTimeout(checkFormState, 0);
            }

            if (e.target.closest('.mi-include-parent')) {
                setTimeout(checkFormState, 0);
            }

            if (e.target.closest('.btnAddMiRule')) {
                var rulesList = e.target.closest('.mediainfo-filter-group').querySelector('.mi-rules-list');
                rulesList.insertAdjacentHTML('beforeend', getMediaInfoRuleHtml(''));
            }

            if (e.target.closest('.btnRemoveMiRule')) {
                e.target.closest('.mi-rule').remove();
            }

            if (e.target.closest('.btnRemoveGroup')) {
                // Name the group so a click on the wrong row is easy to spot.
                var delLabel = (row.querySelector('.txtEntryLabel').value || '').trim();
                var delTag = (row.querySelector('.txtTagName').value || '').trim();
                var delName = delLabel && delTag && delLabel.toLowerCase() !== delTag.toLowerCase()
                    ? '"' + delLabel + '"（标签：' + delTag + '）' 
                    : (delLabel || delTag) ? '"' + (delLabel || delTag) + '"' : '';
                if (confirm(delName ? '删除标签组 ' + delName + '？' : '删除此标签组？')) {
                    row.remove();
                }
            }

            if (e.target.closest('.btnRunEntry')) {
                var entryName = row.querySelector('.txtEntryLabel').value || row.querySelector('.txtTagName').value;
                if (!entryName) { window.Dashboard.alert('分组没有名称或标签。'); return; }
                var doRun = function () {
                    var view = row.closest('#HomeScreenCompanionConfigPage');
                    var btn = row.querySelector('.btnRunEntry');
                    var lbl = btn.querySelector('.btnRunEntryLabel');
                    var btnSaveEl = view ? view.querySelector('.btn-save') : null;
                    var dotEl = view ? view.querySelector('#dotStatus') : null;
                    var labelEl = view ? view.querySelector('#lastRunStatusLabel') : null;
                    // Enter running state
                    lbl.textContent = '运行中…';
                    btn.disabled = true;
                    if (btnSaveEl) { btnSaveEl.disabled = true; btnSaveEl.style.opacity = '0.5'; btnSaveEl.querySelector('span').textContent = '正在同步...'; }
                    if (dotEl) { dotEl.className = 'status-dot running'; }
                    if (labelEl) labelEl.textContent = '运行中...';
                    fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/RunEntry'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-MediaBrowser-Token': window.ApiClient.accessToken() },
                        body: JSON.stringify({ EntryName: entryName })
                    }).then(function (r) { return r.json(); })
                    .then(function (result) {
                        lbl.textContent = '运行组';
                        btn.disabled = false;
                        if (view) refreshStatus(view);
                        window.Dashboard.alert(result.Success ? ('完成：' + result.Message) : ('失败：' + result.Message));
                    }).catch(function () {
                        lbl.textContent = '运行组';
                        btn.disabled = false;
                        if (view) refreshStatus(view);
                        window.Dashboard.alert('请求失败。');
                    });
                };
                var _saveBtn = row.closest('#HomeScreenCompanionConfigPage') ? row.closest('#HomeScreenCompanionConfigPage').querySelector('.btn-save') : document.querySelector('.btn-save');
                var isDirty = _saveBtn && !_saveBtn.disabled;
                if (isDirty) {
                    if (confirm('有未保存的更改。是否保存并运行？')) {
                        _saveBtn.click();
                        setTimeout(doRun, 800);
                    }
                } else {
                    doRun();
                }
            }

            var btnTest = e.target.closest('.btnTestUrl');
            if (btnTest) {
                var uRow = btnTest.closest('.url-row');
                var url = uRow.querySelector('.txtTagUrl').value;
                if (!url) return;

                var limitVal = parseInt(uRow.querySelector('.txtUrlLimit').value, 10) || 0;

                btnTest.disabled = true;
                var urlModal = openSourceTestModal('来源测试', url);
                window.ApiClient.getJSON(window.ApiClient.getUrl("HomeScreenCompanionAnime/TestUrl", { Url: url, Limit: limitVal })).then(result => {
                    if (result.Success) urlModal.show(result);
                    else urlModal.fail(result.Message);
                }).catch(() => urlModal.fail('请求失败。请检查服务器日志。'))
                .finally(() => btnTest.disabled = false);
            }

            var btnTestAi = e.target.closest('.btnTestAiSource');
            if (btnTestAi) {
                var aiContainer = btnTestAi.closest('.source-ai-container');
                var aiProvider = (aiContainer.querySelector('.selAiProvider') || {}).value || 'OpenAI';
                var aiPrompt = ((aiContainer.querySelector('.txtAiPrompt') || {}).value || '').trim();
                var aiIncludeWatched = !!(aiContainer.querySelector('.chkAiRecentlyWatched') || {}).checked;
                var aiWatchedUserId = aiIncludeWatched ? ((aiContainer.querySelector('.selAiWatchedUser') || {}).value || '') : '';
                var aiWatchedCount = parseInt(((aiContainer.querySelector('.txtAiWatchedCount') || {}).value || '20'), 10) || 20;
                var resultSpan = aiContainer.querySelector('.ai-test-result');

                if (!aiPrompt) { if (resultSpan) resultSpan.textContent = '请先输入提示词。'; return; }

                btnTestAi.disabled = true;
                if (resultSpan) resultSpan.textContent = '测试中...';
                var aiModal = openSourceTestModal('AI 来源测试', aiProvider + ' · ' + aiPrompt);

                fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TestAiSource'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-MediaBrowser-Token': window.ApiClient.accessToken() },
                    body: JSON.stringify({
                        Provider: aiProvider,
                        Prompt: aiPrompt,
                        IncludeRecentlyWatched: aiIncludeWatched,
                        RecentlyWatchedUserId: aiWatchedUserId,
                        RecentlyWatchedCount: aiWatchedCount
                    })
                }).then(function(r) { return r.json(); })
                .then(function(result) {
                    if (resultSpan) resultSpan.textContent = result.Success ? result.Message : ('失败：' + result.Message);
                    if (result.Success) aiModal.show(result);
                    else aiModal.fail('AI 测试失败：' + result.Message);
                }).catch(function(err) {
                    if (resultSpan) resultSpan.textContent = '错误：' + err.message;
                    aiModal.fail('错误：' + err.message);
                }).finally(function() { btnTestAi.disabled = false; });
            }
        });

        function updateTagTitle() {
            var lbl = row.querySelector('.txtEntryLabel').value;
            var tag = row.querySelector('.txtTagName').value;
            row.querySelector('.tag-title').textContent = lbl || tag || '新建';
            row.querySelector('.txtTagName').setAttribute('placeholder', lbl);
            row.querySelector('.txtCollectionName').setAttribute('placeholder', lbl);
            var hseCustomTitle = row.querySelector('[data-field="CustomName"]');
            if (hseCustomTitle) hseCustomTitle.setAttribute('placeholder', lbl);
            updateBadges(row);
        }
        row.querySelector('.txtEntryLabel').addEventListener('input', function() {
            updateTagTitle();
        });
        row.querySelector('.txtTagName').addEventListener('input', updateTagTitle);

        var handle = row.querySelector('.drag-handle');

        handle.addEventListener('mousedown', () => {
            if (localStorage.getItem('HomeScreenCompanion_SortBy') === 'Manual') {
                row.setAttribute('draggable', 'true');
            }
        });

        handle.addEventListener('mouseup', () => {
            row.setAttribute('draggable', 'false');
        });

        handle.addEventListener('touchstart', (e) => {
            if (localStorage.getItem('HomeScreenCompanion_SortBy') !== 'Manual') return;
            e.preventDefault();
            var tagContainer = row.closest('#tagListContainer') || row.parentElement;
            document.querySelectorAll('.tag-body').forEach(b => b.style.display = 'none');
            document.querySelectorAll('.expand-icon').forEach(i => i.innerText = 'expand_more');
            row.classList.add('dragging');

            const onTouchMove = (ev) => {
                ev.preventDefault();
                const touch = ev.touches[0];
                const afterEl = getDragAfterElement(tagContainer, touch.clientY);
                let ph = tagContainer.querySelector('.sort-placeholder');
                if (!ph) { ph = document.createElement('div'); ph.className = 'sort-placeholder'; }
                if (afterEl == null) { if (ph.nextElementSibling !== null) tagContainer.appendChild(ph); }
                else { if (ph.nextElementSibling !== afterEl) tagContainer.insertBefore(ph, afterEl); }
            };

            const onTouchEnd = () => {
                document.removeEventListener('touchmove', onTouchMove);
                document.removeEventListener('touchend', onTouchEnd);
                document.removeEventListener('touchcancel', onTouchCancel);
                row.classList.remove('dragging');
                const ph = tagContainer.querySelector('.sort-placeholder');
                if (ph) { tagContainer.insertBefore(row, ph); ph.remove(); }
                row.classList.add('just-moved');
                setTimeout(() => { row.classList.remove('just-moved'); }, 2000);
                setTimeout(checkFormState, 0);
            };

            const onTouchCancel = () => {
                document.removeEventListener('touchmove', onTouchMove);
                document.removeEventListener('touchend', onTouchEnd);
                document.removeEventListener('touchcancel', onTouchCancel);
                row.classList.remove('dragging');
                const ph = tagContainer.querySelector('.sort-placeholder');
                if (ph) ph.remove();
            };

            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
            document.addEventListener('touchcancel', onTouchCancel);
        }, { passive: false });

        row.querySelector('.btnDuplicateRow').addEventListener('click', () => {
            var config = readRowAsConfig(row);
            config.Name = (config.Name || config.Tag || '来源') + ' (副本)';
            renderTagGroup(config, row.closest('#tagListContainer'), true, undefined, true);
            applyFilters(view);
            setTimeout(checkFormState, 0);
        });

        row.addEventListener('dragstart', (e) => {
            if (localStorage.getItem('HomeScreenCompanion_SortBy') !== 'Manual') { e.preventDefault(); return; }

            document.querySelectorAll('.tag-body').forEach(b => b.style.display = 'none');
            document.querySelectorAll('.expand-icon').forEach(i => i.innerText = 'expand_more');

            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '');

            setTimeout(() => {
                row.style.display = 'none';
            }, 0);
        });

        row.addEventListener('dragend', () => {
            row.style.display = '';

            row.classList.remove('dragging');
            row.setAttribute('draggable', 'false');

            var existingPlaceholder = document.querySelector('.sort-placeholder');
            if (existingPlaceholder) existingPlaceholder.remove();

            row.classList.add('just-moved');
            setTimeout(() => { row.classList.remove('just-moved'); }, 2000);

            setTimeout(checkFormState, 0);
        });

        row.querySelector('.btnChoosePoster').addEventListener('click', function () {
            row.querySelector('.inputPosterFile').click();
        });

        row.querySelector('.inputPosterFile').addEventListener('change', function () {
            var file = this.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (e) {
                var dataUrl = e.target.result;
                var base64 = dataUrl.split(',')[1];
                var img = row.querySelector('.poster-preview-img');
                img.src = dataUrl;
                img.style.display = 'block';

                var headers = { 'Content-Type': 'application/json' };
                var token = window.ApiClient.accessToken();
                if (token) headers['X-Emby-Token'] = token;
                fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/UploadCollectionImage'), {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ FileName: file.name, Base64Data: base64, OldFilePath: row.querySelector('.hiddenPosterPath').value })
                }).then(function (r) { return r.json(); })
                .then(function (result) {
                    if (result.Success) {
                        row.querySelector('.hiddenPosterPath').value = result.FilePath;
                        row.querySelector('.poster-filename').textContent = file.name;
                        row.querySelector('.poster-preview-container').style.display = 'block';
                    } else {
                        window.Dashboard.alert('上传失败：' + (result.Message || '未知错误'));
                        img.style.display = 'none';
                    }
                }).catch(function () {
                    window.Dashboard.alert('上传出错。请检查服务器日志。');
                    img.style.display = 'none';
                });
            };
            reader.readAsDataURL(file);
        });

        row.querySelector('.btnRemovePoster').addEventListener('click', function () {
            row.querySelector('.hiddenPosterPath').value = '';
            row.querySelector('.poster-filename').textContent = '';
            row.querySelector('.poster-preview-container').style.display = 'none';
            row.querySelector('.poster-preview-img').style.display = 'none';
            row.querySelector('.inputPosterFile').value = '';
        });

        row.querySelector('.btnLoadPosterUrl').addEventListener('click', function () {
            var url = row.querySelector('.txtPosterUrl').value.trim();
            if (!url) return;

            var headers = { 'Content-Type': 'application/json' };
            var token = window.ApiClient.accessToken();
            if (token) headers['X-Emby-Token'] = token;

            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/FetchCollectionImageFromUrl'), {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ Url: url, OldFilePath: row.querySelector('.hiddenPosterPath').value })
            }).then(function (r) { return r.json(); })
            .then(function (result) {
                if (result.Success) {
                    row.querySelector('.hiddenPosterPath').value = result.FilePath;
                    row.querySelector('.poster-filename').textContent = url.split('/').pop().split('?')[0];
                    row.querySelector('.poster-preview-container').style.display = 'block';
                    var img = row.querySelector('.poster-preview-img');
                    img.src = url;
                    img.style.display = 'block';
                    row.querySelector('.txtPosterUrl').value = '';
                } else {
                    window.Dashboard.alert('加载图片失败：' + (result.Message || '未知错误'));
                }
            }).catch(function () {
                window.Dashboard.alert('获取图片时出错。请检查 URL 和服务器日志。');
            });
        });

        setTimeout(function () { updateHseSectionAvailability(row); }, 0);
    }


    // Renders the merged execution log as colour-coded lines. Classification is based on the
    // leading symbol each server task writes (✔ ⚠ ✖ –) and on the [DEBUG] token (RunLog.Debug), which is
    // stripped for display. Heading patterns must match the exact heading text the C# tasks emit. A source badge is shown only when several tasks have output.
    function renderLogLines(container, entries, isRunning) {
        var stickToBottom = isRunning && (container.scrollHeight - container.scrollTop - container.clientHeight) < 40;
        var wasEmpty = container.childElementCount === 0;
        if (!entries.length) { container.textContent = '（暂无日志）'; return; }

        var srcCount = {};
        entries.forEach(function (e) { srcCount[e.src] = 1; });
        var showSrc = Object.keys(srcCount).length > 1;

        var frag = document.createDocumentFragment();
        entries.forEach(function (e) {
            var raw = e.text || '';
            var ts = '';
            var m = raw.match(/^\[(\d{2}:\d{2}:\d{2})\] ?/);
            if (m) { ts = m[1]; raw = raw.substring(m[0].length); }

            var cls = '';
            if (/^\[DEBUG\] ?/.test(raw)) { cls = 'log-debug'; raw = raw.replace(/^\[DEBUG\] ?/, ''); }
            else if (raw.trim() === '') cls = 'log-blank';
            else if (/^═+$/.test(raw.trim())) cls = 'log-rule';
            else if (raw.indexOf('✖') >= 0) cls = 'log-err';
            else if (raw.indexOf('⚠') >= 0) cls = 'log-warn';
            else if (raw.indexOf('✔') >= 0) cls = 'log-ok';
            else if (/^\s{1,3}– /.test(raw)) cls = 'log-skip';
            else if (/^(»|结果$|汇总$|\[Cleanup\]$|\[\d+\/\d+\] |Home Screen Companion |主屏幕同步 |动漫合集同步 )/.test(raw)) cls = 'log-head';

            var line = document.createElement('div');
            line.className = 'log-line' + (cls ? ' ' + cls : '');
            if (cls !== 'log-blank') {
                var tsEl = document.createElement('span');
                tsEl.className = 'log-ts';
                tsEl.textContent = ts;
                line.appendChild(tsEl);
                if (showSrc) {
                    var srcEl = document.createElement('span');
                    srcEl.className = 'log-src';
                    srcEl.textContent = e.src;
                    line.appendChild(srcEl);
                }
                line.appendChild(document.createTextNode(raw));
            } else {
                line.textContent = ' ';
            }
            frag.appendChild(line);
        });
        container.textContent = '';
        container.appendChild(frag);
        if (stickToBottom || wasEmpty) container.scrollTop = container.scrollHeight;
    }

    // Popup for the "Test" buttons on list/AI sources: shows every item the source returned and
    // whether it exists in the library. Opens in a loading state; call .show(result) or .fail(msg).
    function openSourceTestModal(title, subtitle) {
        function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

        var overlay = document.createElement('div');
        overlay.className = 'modal-backdrop';
        overlay.innerHTML =
            '<div class="modal-content stm-content">' +
                '<div class="modal-header-bar stm-header">' +
                    '<i class="md-icon modal-header-icon">fact_check</i>' +
                    '<div style="min-width:0;">' +
                        '<h2 class="modal-header-title">' + esc(title) + '</h2>' +
                        (subtitle ? '<span class="stm-sub">' + esc(subtitle) + '</span>' : '') +
                    '</div>' +
                    '<button type="button" class="stm-close" title="关闭"><i class="md-icon">close</i></button>' +
                '</div>' +
                '<div class="stm-body" style="display:flex;flex-direction:column;min-height:0;flex:1;">' +
                    '<div class="stm-empty"><i class="md-icon" style="font-size:2em;display:block;margin-bottom:8px;">hourglass_empty</i>正在获取来源…</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.classList.add('modal-visible'); });

        function close() {
            overlay.classList.remove('modal-visible');
            document.removeEventListener('keydown', onKey);
            setTimeout(function () { overlay.remove(); }, 300);
        }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || e.target.closest('.stm-close') || e.target.closest('.stm-done')) close();
        });

        var body = overlay.querySelector('.stm-body');

        function show(result) {
            var items = result.Items || [];
            var inCount = items.filter(function (i) { return i.InLibrary; }).length;
            var outCount = items.length - inCount;
            var pct = items.length ? Math.round(inCount * 100 / items.length) : 0;
            var filter = 'all';

            function rowHtml(item, idx) {
                var poster = item.InLibrary && item.LibraryItemId
                    ? '<div class="stm-poster" style="background-image:url(&quot;' + esc(window.ApiClient.getImageUrl(item.LibraryItemId, { type: 'Primary', maxHeight: 100 })) + '&quot;)"></div>'
                    : '<div class="stm-poster"><i class="md-icon">movie</i></div>';
                var year = item.Year || item.LibraryYear;
                var meta = [];
                if (year) meta.push(year);
                if (item.ItemType) meta.push(item.ItemType === 'Series' ? '剧集' : '电影');
                if (item.Imdb) meta.push('<a href="https://www.imdb.com/title/' + encodeURIComponent(item.Imdb) + '/" target="_blank" rel="noopener">' + esc(item.Imdb) + '</a>');
                else meta.push('无 IMDb ID');
                if (item.MatchedByTitle) meta.push('按标题匹配');
                if (item.InLibrary && item.LibraryName && item.LibraryName.toLowerCase() !== (item.Name || '').toLowerCase())
                    meta.push('媒体库名称：“' + esc(item.LibraryName) + '”');
                return '<div class="stm-row ' + (item.InLibrary ? 'found' : 'missing') + '" style="animation-delay:' + Math.min(idx * 15, 400) + 'ms">' +
                    '<div class="stm-rank">' + (idx + 1) + '</div>' +
                    poster +
                    '<div class="stm-info">' +
                        '<div class="stm-title" title="' + esc(item.Name) + '">' + esc(item.Name || '（无标题）') + '</div>' +
                        '<div class="stm-meta">' + meta.join(' · ') + '</div>' +
                    '</div>' +
                    '<div class="stm-status ' + (item.InLibrary ? 'in' : 'out') + '" title="' + (item.InLibrary ? '已在媒体库中' : '不在媒体库中') + '">' +
                        '<i class="md-icon">' + (item.InLibrary ? 'check' : 'close') + '</i>' +
                    '</div>' +
                '</div>';
            }

            function renderList() {
                var html = '';
                items.forEach(function (item, idx) {
                    if (filter === 'in' && !item.InLibrary) return;
                    if (filter === 'out' && item.InLibrary) return;
                    html += rowHtml(item, idx);
                });
                body.querySelector('.stm-list').innerHTML = html || '<div class="stm-empty">无可显示内容。</div>'; 
                body.querySelectorAll('.stm-chip').forEach(function (c) { c.classList.toggle('active', c.dataset.filter === filter); });
            }

            body.innerHTML =
                '<div class="stm-summary">' +
                    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">' +
                        '<span><strong style="font-size:1.4em;">' + inCount + '</strong> <span style="opacity:0.7;">/ ' + items.length + ' 项已在媒体库中</span></span>' +
                        '<span style="font-weight:bold;color:' + (pct >= 50 ? '#52B54B' : '#e6c15a') + ';">' + pct + '%</span>' +
                    '</div>' +
                    '<div class="stm-bar"><div class="stm-bar-fill" style="width:0%"></div></div>' +
                    '<div class="stm-filters">' +
                        '<button type="button" class="stm-chip" data-filter="all"><i class="md-icon">list</i>全部 ' + items.length + '</button>' +
                        '<button type="button" class="stm-chip stm-chip-in" data-filter="in"><i class="md-icon">check_circle</i>已在媒体库中 ' + inCount + '</button>' +
                        '<button type="button" class="stm-chip stm-chip-out" data-filter="out"><i class="md-icon">cancel</i>缺失 ' + outCount + '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="stm-list"></div>' +
                '<div class="stm-footer"><span>按 IMDb ID 匹配' + (items.some(function (i) { return i.MatchedByTitle; }) ? '，以标题 + 年份作为备用匹配方式' : '') + '</span><button type="button" class="stm-done">关闭</button></div>';

            body.querySelector('.stm-filters').addEventListener('click', function (e) {
                var chip = e.target.closest('.stm-chip');
                if (!chip) return;
                filter = chip.dataset.filter;
                renderList();
            });
            renderList();
            requestAnimationFrame(function () {
                requestAnimationFrame(function () { body.querySelector('.stm-bar-fill').style.width = pct + '%'; });
            });
        }

        function fail(message) {
            body.innerHTML =
                '<div class="stm-empty"><i class="md-icon" style="font-size:2.4em;display:block;margin-bottom:8px;color:#e57373;">error_outline</i>' + esc(message) + '</div>' +
                '<div class="stm-footer"><button type="button" class="stm-done">关闭</button></div>';
        }

        return { show: show, fail: fail };
    }

    // Picks which task's log to show (running task, else the most recently started one, unless the
    // user chose a tab), updates the tab bar and renders that single log.
    function renderLogModal(view) {
        var content = view.querySelector('#logContent');
        var tabs = view.querySelectorAll('#logTabs .log-tab');
        if (!content) return;

        var keys = ['sync', 'hsc', 'tl', 'anime'];
        function startedMs(k) { var s = _lastStatus[k]; var t = s && s.StartedUtc ? Date.parse(s.StartedUtc) : NaN; return isNaN(t) ? 0 : t; }
        function running(k) { return !!(_lastStatus[k] && _lastStatus[k].IsRunning); }
        function logs(k) { return (_lastStatus[k] && _lastStatus[k].Logs) || []; }

        var selected = _logTab;
        if (!selected) {
            selected = keys.filter(running)[0];
            if (!selected) {
                var best = 0;
                keys.forEach(function (k) { if (startedMs(k) > best) { best = startedMs(k); selected = k; } });
            }
            if (!selected) selected = 'sync';
        }

        tabs.forEach(function (tab) {
            var k = tab.getAttribute('data-log');
            tab.classList.toggle('active', k === selected);
            tab.classList.toggle('empty', logs(k).length === 0 && !running(k));
            var dot = tab.querySelector('.status-dot');
            if (dot) { dot.className = 'status-dot'; if (running(k)) dot.classList.add('running'); dot.style.visibility = (running(k) || logs(k).length) ? 'visible' : 'hidden'; }
            var timeEl = tab.querySelector('.log-tab-time');
            if (timeEl) {
                var ms = startedMs(k);
                timeEl.textContent = ms ? new Date(ms).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            }
        });

        var entries = logs(selected).map(function (l) { return { src: selected, text: l }; });
        if (!entries.length) { content.textContent = '（暂无运行记录）'; return; }
        renderLogLines(content, entries, running(selected));
    }


    function syncAnimeModeFromCheckbox(view) {
        var dry = view.querySelector('#chkAnimeDryRun');
        var scheduled = view.querySelector('#chkAnimeScheduledWrite');
        if (!dry || !scheduled) return;
        scheduled.checked = !dry.checked;
        updateAnimeGlobalDryHint(view);
    }

    function syncAnimeCheckboxFromScheduled(view) {
        var dry = view.querySelector('#chkAnimeDryRun');
        var scheduled = view.querySelector('#chkAnimeScheduledWrite');
        if (!dry || !scheduled) return;
        dry.checked = !scheduled.checked;
        updateAnimeGlobalDryHint(view);
        try { checkFormState(); } catch (e) { }
    }

    function updateAnimeGlobalDryHint(view) {
        var hint = view.querySelector('#animeGlobalDryHint');
        if (!hint) return;
        var globalDry = false;
        try {
            if (originalConfigState) globalDry = !!JSON.parse(originalConfigState).DryRunMode;
        } catch (e) { }
        var live = view.querySelector('#chkDryRunMode');
        if (live) globalDry = !!live.checked;
        hint.style.display = globalDry ? 'block' : 'none';
    }

    function animeStatusLabel(status) {
        switch (status) {
            case 'will_create': return '将新建';
            case 'will_update': return '将更新';
            case 'created': return '已新建';
            case 'updated': return '已更新';
            case 'unchanged': return '无需改动';
            case 'skipped': return '跳过';
            default: return status || '';
        }
    }

    function renderAnimeCards(view, summary) {
        var grid = view.querySelector('#animeCardGrid');
        var empty = view.querySelector('#animeCardEmpty');
        var heading = view.querySelector('#animeCardsHeading');
        var hint = view.querySelector('#animeCardsHint');
        var line = view.querySelector('#animeLastRunSummaryLine');
        if (!grid) return;
        grid.innerHTML = '';
        summary = summary || {};
        view._animeLastSummary = summary;
        var cards = summary.Cards || [];
        var owned = summary.Owned || [];
        var dry = !!summary.DryRun;
        if (line) line.textContent = summary.StatusText || '';
        if (heading) heading.textContent = dry ? '预览结果' : '合集一览';
        if (hint) {
            if (dry) hint.textContent = '仅预览，尚未写入媒体库';
            else if (summary.GlobalDryRun) hint.textContent = '全局仅预览仍开着，实际未写入';
            else hint.textContent = owned.length ? ('插件管理 ' + owned.length + ' 个合集') : '';
        }

        function addCard(card) {
            var el = document.createElement('div');
            el.className = 'anime-card' + (card.HasReminder ? ' has-reminder' : '');
            if (card.Key) el.setAttribute('data-anime-key', card.Key);
            if (card.Name) el.setAttribute('data-anime-name', card.Name);
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.title = '点击编辑合集';
            el.addEventListener('click', function () {
                openAnimeCollectionEditor(view, { key: card.Key || '', name: card.Name || '' });
            });
            el.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    openAnimeCollectionEditor(view, { key: card.Key || '', name: card.Name || '' });
                }
            });
            var st = card.Status || '';
            var titles = card.MemberTitles || [];
            var members = titles.join('、');
            if (card.MoreCount > 0) members += (members ? '；' : '') + '还有 ' + card.MoreCount + ' 部';
            var reason = card.Reason || '';
            var titleRow = document.createElement('div');
            titleRow.className = 'anime-card-title-row';
            titleRow.appendChild(Object.assign(document.createElement('div'), { className: 'anime-card-title', textContent: card.Name || '未命名合集' }));
            if (card.HasReminder) {
                var dot = document.createElement('span');
                dot.className = 'anime-card-dot';
                dot.title = '有未处理提醒';
                titleRow.appendChild(dot);
            }
            el.appendChild(titleRow);
            var stEl = document.createElement('div');
            stEl.className = 'anime-card-status ' + st;
            stEl.textContent = animeStatusLabel(st);
            el.appendChild(stEl);
            if (members) {
                var m = document.createElement('div');
                m.className = 'anime-card-members';
                m.textContent = members;
                el.appendChild(m);
            } else if (card.MemberCount > 0) {
                var m2 = document.createElement('div');
                m2.className = 'anime-card-members';
                m2.textContent = card.MemberCount + ' 部';
                el.appendChild(m2);
            }
            if (reason) {
                var r = document.createElement('div');
                r.className = 'anime-card-reason';
                r.textContent = reason;
                el.appendChild(r);
            }
            grid.appendChild(el);
        }

        if (cards.length) {
            cards.forEach(addCard);
            if (empty) empty.style.display = 'none';
        } else if (!dry && owned.length) {
            owned.forEach(function (o) {
                addCard({
                    Key: o.Key || '',
                    Name: o.Name || '未命名合集',
                    Status: 'unchanged',
                    MemberCount: o.MemberCount || 0,
                    MemberTitles: [],
                    MoreCount: 0,
                    Reason: '',
                    HasReminder: !!o.HasReminder
                });
            });
            if (empty) empty.style.display = 'none';
        } else {
            if (empty) {
                empty.style.display = '';
                if (!summary || (!summary.StatusText && !(summary.Cards || []).length && !(summary.Owned || []).length)) {
                    empty.textContent = '还没有合集结果。先打开「启用动漫合集」，再点「立即同步」。同步后会先弹出确认创建。';
                } else if (dry) {
                    empty.textContent = '这次预览没有合集候选。确认已启用，或稍后再点「立即同步」。';
                } else {
                    empty.textContent = '当前没有可显示的合集。启用后点「立即同步」即可生成。';
                }
            }
        }

        renderAnimeReminders(view, summary);
    }

    function animeReminderFilter(view) {
        return view._animeReminderFilter || 'open';
    }

    function renderAnimeReminders(view, summary) {
        var list = view.querySelector('#animeReminderList');
        var empty = view.querySelector('#animeRemindersEmpty');
        var hint = view.querySelector('#animeRemindersHint');
        if (!list) return;
        list.innerHTML = '';
        summary = summary || {};
        var items = summary.ReminderItems || [];
        var filter = animeReminderFilter(view);
        var openCount = items.filter(function (r) { return r && !r.Handled; }).length;
        var handledCount = items.length - openCount;
        if (hint) {
            if (!items.length) hint.textContent = '';
            else hint.textContent = '未处理 ' + openCount + (handledCount ? (' · 已处理 ' + handledCount) : '');
        }

        var shown = items.filter(function (r) {
            if (!r) return false;
            if (filter === 'open') return !r.Handled;
            if (filter === 'handled') return !!r.Handled;
            return true;
        });

        if (!shown.length) {
            if (empty) {
                empty.style.display = '';
                if (!items.length) empty.textContent = '暂无提醒。同步时吃不准的合集会出现在这里。';
                else if (filter === 'open') empty.textContent = '没有未处理提醒。';
                else if (filter === 'handled') empty.textContent = '还没有已处理提醒。';
                else empty.textContent = '暂无提醒。';
            }
            return;
        }
        if (empty) empty.style.display = 'none';

        shown.forEach(function (item) {
            var row = document.createElement('div');
            row.className = 'anime-reminder-row' + (item.Handled ? ' handled' : '');
            row.setAttribute('data-reminder-id', item.Id || '');

            var typeEl = document.createElement('div');
            typeEl.className = 'anime-reminder-type';
            typeEl.textContent = item.TypeLabel || '需要留意';
            row.appendChild(typeEl);

            var nameEl = document.createElement('div');
            nameEl.className = 'anime-reminder-name';
            nameEl.textContent = item.CollectionName || item.CollectionKey || '未命名合集';
            row.appendChild(nameEl);

            if (item.Reason) {
                var reasonEl = document.createElement('div');
                reasonEl.className = 'anime-reminder-reason';
                reasonEl.textContent = item.Reason;
                row.appendChild(reasonEl);
            }

            var actions = document.createElement('div');
            actions.className = 'anime-reminder-actions';

            var goBtn = document.createElement('button');
            goBtn.type = 'button';
            goBtn.setAttribute('is', 'emby-button');
            goBtn.className = 'raised btn-neutral';
            goBtn.textContent = '去处理';
            goBtn.addEventListener('click', function () {
                focusAnimeReminderTarget(view, item);
            });
            actions.appendChild(goBtn);

            var suggested = (item.SuggestedName || '').trim();
            if (!suggested && item.Type === 'naming' && item.Reason) {
                var m = /建议改用「([^」]+)」/.exec(item.Reason);
                if (m) suggested = m[1];
            }
            if (suggested && item.CollectionKey) {
                var adoptRemBtn = document.createElement('button');
                adoptRemBtn.type = 'button';
                adoptRemBtn.setAttribute('is', 'emby-button');
                adoptRemBtn.className = 'raised button-submit';
                adoptRemBtn.textContent = '采用建议显示名';
                adoptRemBtn.addEventListener('click', function () {
                    adoptAnimeSuggestedName(view, {
                        Id: item.Id || '',
                        CollectionKey: item.CollectionKey,
                        SuggestedName: suggested
                    }, adoptRemBtn);
                });
                actions.appendChild(adoptRemBtn);
            }

            var markBtn = document.createElement('button');
            markBtn.type = 'button';
            markBtn.setAttribute('is', 'emby-button');
            markBtn.className = 'raised btn-neutral';
            markBtn.textContent = item.Handled ? '标为未处理' : '标为已处理';
            markBtn.addEventListener('click', function () {
                setAnimeReminderHandled(view, item.Id, !item.Handled, markBtn);
            });
            actions.appendChild(markBtn);

            row.appendChild(actions);
            list.appendChild(row);
        });
    }

    function focusAnimeReminderTarget(view, item) {
        openAnimeCollectionEditor(view, {
            key: (item && item.CollectionKey) || '',
            name: (item && item.CollectionName) || '',
            reminderId: (item && item.Id) || ''
        });
    }

    function showAnimeStudioMain(view) {
        var main = view.querySelector('#animeStudioMain');
        var panel = view.querySelector('#animeEditorPanel');
        if (main) main.style.display = '';
        if (panel) panel.style.display = 'none';
        view._animeEditor = null;
    }

    function showAnimeEditorPanel(view) {
        var main = view.querySelector('#animeStudioMain');
        var panel = view.querySelector('#animeEditorPanel');
        if (main) main.style.display = 'none';
        if (panel) panel.style.display = '';
    }

    function openAnimeCollectionEditor(view, opts) {
        opts = opts || {};
        var key = (opts.key || '').trim();
        var name = (opts.name || '').trim();
        if (!key) {
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert(name
                    ? ('「' + name + '」还没有合集编号，请先同步一次后再编辑。')
                    : '请先同步，生成合集后再编辑。');
            }
            return;
        }
        showAnimeEditorPanel(view);
        view._animeEditor = { key: key, name: name, reminderId: opts.reminderId || '', members: [] };
        var heading = view.querySelector('#animeEditorHeading');
        if (heading) heading.textContent = '编辑合集';
        var nameInput = view.querySelector('#txtAnimeEditorName');
        if (nameInput) nameInput.value = name || '';
        var hint = view.querySelector('#animeEditorHint');
        if (hint) hint.textContent = '正在加载…';
        var membersEl = view.querySelector('#animeEditorMembers');
        if (membersEl) membersEl.innerHTML = '';
        var empty = view.querySelector('#animeEditorMembersEmpty');
        if (empty) empty.style.display = 'none';
        var search = view.querySelector('#txtAnimeEditorSearch');
        if (search) search.value = '';
        var results = view.querySelector('#animeEditorSearchResults');
        if (results) { results.innerHTML = ''; results.style.display = 'none'; }
        window.ApiClient.getJSON(window.ApiClient.getUrl('HomeScreenCompanionAnime/Anime/CollectionEditor', { Key: key }))
            .then(function (data) {
                if (!data || !data.Success) {
                    if (hint) hint.textContent = (data && data.Message) || '无法打开编辑。';
                    if (window.Dashboard && window.Dashboard.alert) {
                        window.Dashboard.alert((data && data.Message) || '无法打开编辑。');
                    }
                    return;
                }
                view._animeEditor.key = data.Key || key;
                view._animeEditor.hasManualMembers = !!data.HasManualMembers;
                if (nameInput) nameInput.value = data.DisplayName || name || '';
                view._animeEditor.members = (data.Members || []).map(function (m) {
                    return {
                        IncludeId: m.IncludeId || '',
                        Title: m.Title || '',
                        InLibrary: !!m.InLibrary,
                        Selected: m.Selected !== false
                    };
                });
                renderAnimeEditorMembers(view);
                if (hint) {
                    hint.textContent = data.HasManualMembers
                        ? '当前按你保存的成员名单同步。可改名、勾选成员后保存；也可改回自动归类。'
                        : '当前仍跟自动分组。保存后会记住你勾选的成员；显示名称会记下来供新建合集使用。';
                }
            })
            .catch(function (err) {
                if (hint) hint.textContent = '加载失败。';
                if (window.Dashboard && window.Dashboard.alert) {
                    window.Dashboard.alert('无法打开编辑：' + (err && err.message ? err.message : err));
                }
            });
    }

    function renderAnimeEditorMembers(view) {
        var box = view.querySelector('#animeEditorMembers');
        var empty = view.querySelector('#animeEditorMembersEmpty');
        if (!box) return;
        box.innerHTML = '';
        var state = view._animeEditor || { members: [] };
        var members = state.members || [];
        if (!members.length) {
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';
        members.forEach(function (m, index) {
            var row = document.createElement('div');
            row.className = 'anime-editor-member';
            var label = document.createElement('label');
            var chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = !!m.Selected;
            chk.addEventListener('change', function () {
                m.Selected = !!chk.checked;
            });
            var text = document.createElement('div');
            var title = document.createElement('div');
            title.className = 'title';
            title.textContent = m.Title || '未命名作品';
            text.appendChild(title);
            if (!m.InLibrary) {
                var meta = document.createElement('div');
                meta.className = 'meta';
                meta.textContent = '库中暂未找到对应片源';
                text.appendChild(meta);
            }
            label.appendChild(chk);
            label.appendChild(text);
            row.appendChild(label);
            box.appendChild(row);
        });
    }


    function animeEditorAddMember(view, hit) {
        if (!view._animeEditor) return;
        var includeId = (hit && hit.IncludeId) || '';
        if (!includeId) return;
        var members = view._animeEditor.members || [];
        for (var i = 0; i < members.length; i++) {
            if (members[i].IncludeId === includeId) {
                members[i].Selected = true;
                members[i].Title = hit.Title || members[i].Title;
                members[i].InLibrary = true;
                renderAnimeEditorMembers(view);
                return;
            }
        }
        members.push({
            IncludeId: includeId,
            Title: hit.Title || '未命名作品',
            InLibrary: true,
            Selected: true
        });
        view._animeEditor.members = members;
        renderAnimeEditorMembers(view);
    }

    function animeEditorSearch(view, query) {
        var results = view.querySelector('#animeEditorSearchResults');
        if (!results) return;
        query = (query || '').trim();
        if (query.length < 1) {
            results.innerHTML = '';
            results.style.display = 'none';
            return;
        }
        var reqId = (view._animeEditorSearchId = (view._animeEditorSearchId || 0) + 1);
        window.ApiClient.getJSON(window.ApiClient.getUrl('HomeScreenCompanionAnime/Anime/MediaSearch', { Q: query }))
            .then(function (data) {
                if (reqId !== view._animeEditorSearchId) return;
                results.innerHTML = '';
                var items = (data && data.Items) || [];
                if (!items.length) {
                    results.style.display = 'none';
                    return;
                }
                items.forEach(function (hit) {
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'anime-editor-search-hit';
                    var label = hit.Title || '未命名';
                    if (hit.Year) label += '（' + hit.Year + '）';
                    if (hit.Kind) label += ' · ' + hit.Kind;
                    btn.textContent = label;
                    btn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
                    btn.addEventListener('click', function () {
                        animeEditorAddMember(view, hit);
                        results.innerHTML = '';
                        results.style.display = 'none';
                        var search = view.querySelector('#txtAnimeEditorSearch');
                        if (search) search.value = '';
                    });
                    results.appendChild(btn);
                });
                results.style.display = 'block';
            })
            .catch(function () {
                if (reqId !== view._animeEditorSearchId) return;
                results.innerHTML = '';
                results.style.display = 'none';
            });
    }

    function applyAnimeEditorConfigToForm(view, result) {
        if (!result) return;
        var rules = view.querySelector('#txtAnimeCollectionRulesJson');
        var aliases = view.querySelector('#txtAnimeCollectionAliasesJson');
        var approved = view.querySelector('#txtAnimeApprovedCollectionKeys');
        if (rules && typeof result.AnimeCollectionRulesJson === 'string') rules.value = result.AnimeCollectionRulesJson;
        if (aliases && typeof result.AnimeCollectionAliasesJson === 'string') aliases.value = result.AnimeCollectionAliasesJson;
        if (approved && typeof result.AnimeApprovedCollectionKeys === 'string') approved.value = result.AnimeApprovedCollectionKeys;
        try {
            originalConfigState = JSON.stringify(getUiConfig(view, true));
            checkFormState();
        } catch (e) { }
    }

    function saveAnimeCollectionEditor(view) {
        var state = view._animeEditor;
        if (!state || !state.key) return;
        var nameInput = view.querySelector('#txtAnimeEditorName');
        var displayName = nameInput ? (nameInput.value || '').trim() : '';
        if (!displayName) {
            if (window.Dashboard && window.Dashboard.alert) window.Dashboard.alert('请填写显示名称。');
            return;
        }
        var includeIds = (state.members || []).filter(function (m) { return m && m.Selected && m.IncludeId; })
            .map(function (m) { return m.IncludeId; });
        if (!includeIds.length) {
            if (window.Dashboard && window.Dashboard.alert) window.Dashboard.alert('请至少勾选一部作品。');
            return;
        }
        var btn = view.querySelector('#btnAnimeEditorSave');
        if (btn) btn.disabled = true;
        var tok = window.ApiClient.accessToken();
        var headers = { 'Content-Type': 'application/json' };
        if (tok) headers['X-MediaBrowser-Token'] = tok;
        fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Anime/CollectionEditor/Save'), {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: JSON.stringify({
                Key: state.key,
                DisplayName: displayName,
                IncludeIds: includeIds,
                MarkRemindersHandled: true
            })
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        }).then(function (result) {
            if (!(result && result.Success)) {
                if (window.Dashboard && window.Dashboard.alert) {
                    window.Dashboard.alert((result && result.Message) || '保存失败。');
                }
                return;
            }
            applyAnimeEditorConfigToForm(view, result);
            if (result.Summary) renderAnimeCards(view, result.Summary);
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert(result.Message || '已保存。');
            }
            showAnimeStudioMain(view);
        }).catch(function (err) {
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert('保存失败：' + (err && err.message ? err.message : err));
            }
        }).then(function () {
            if (btn) btn.disabled = false;
        });
    }

    function clearAnimeCollectionEditorRule(view) {
        var state = view._animeEditor;
        if (!state || !state.key) return;
        if (!window.confirm('改回自动归类后，下次同步会按作品关系重新分组。确定吗？')) return;
        var btn = view.querySelector('#btnAnimeEditorAuto');
        if (btn) btn.disabled = true;
        var tok = window.ApiClient.accessToken();
        var headers = { 'Content-Type': 'application/json' };
        if (tok) headers['X-MediaBrowser-Token'] = tok;
        fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Anime/CollectionEditor/ClearRule'), {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: JSON.stringify({ Key: state.key, MarkRemindersHandled: true })
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        }).then(function (result) {
            if (!(result && result.Success)) {
                if (window.Dashboard && window.Dashboard.alert) {
                    window.Dashboard.alert((result && result.Message) || '操作失败。');
                }
                return;
            }
            applyAnimeEditorConfigToForm(view, result);
            if (result.Summary) renderAnimeCards(view, result.Summary);
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert(result.Message || '已改回自动归类。');
            }
            showAnimeStudioMain(view);
        }).catch(function (err) {
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert('操作失败：' + (err && err.message ? err.message : err));
            }
        }).then(function () {
            if (btn) btn.disabled = false;
        });
    }

    function cssAttrEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function adoptAnimeSuggestedName(view, payload, button) {
        if (!payload || !payload.CollectionKey || !payload.SuggestedName) return;
        if (button) button.disabled = true;
        var tok = window.ApiClient.accessToken();
        var headers = { 'Content-Type': 'application/json' };
        if (tok) headers['X-MediaBrowser-Token'] = tok;
        fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Anime/Reminders/AdoptName'), {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: JSON.stringify({
                Id: payload.Id || '',
                CollectionKey: payload.CollectionKey,
                SuggestedName: payload.SuggestedName
            })
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        }).then(function (result) {
            if (!(result && result.Success)) {
                if (window.Dashboard && window.Dashboard.alert) {
                    window.Dashboard.alert((result && result.Message) || '无法采用建议名称。');
                }
                if (button) button.disabled = false;
                return;
            }
            if (typeof result.AnimeCollectionAliasesJson === 'string') {
                applyAnimeEditorConfigToForm(view, result);
            }
            if (result.Summary) renderAnimeCards(view, result.Summary);
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert(result.Message || '已采用建议显示名。');
            }
            try { loadAnimeAiAnalysis(view); } catch (e) { }
        }).catch(function (err) {
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert('无法采用建议名称：' + (err && err.message ? err.message : err));
            }
            if (button) button.disabled = false;
        });
    }

    function setAnimeReminderHandled(view, id, handled, button) {
        if (!id) return;
        if (button) button.disabled = true;
        var tok = window.ApiClient.accessToken();
        var headers = { 'Content-Type': 'application/json' };
        if (tok) headers['X-MediaBrowser-Token'] = tok;
        fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Anime/Reminders/Handled'), {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: JSON.stringify({ Id: id, Handled: !!handled })
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        }).then(function (result) {
            if (result && result.Success && result.Summary) {
                renderAnimeCards(view, result.Summary);
            } else {
                if (window.Dashboard && window.Dashboard.alert) {
                    window.Dashboard.alert((result && result.Message) || '无法更新提醒状态。');
                }
                if (button) button.disabled = false;
            }
        }).catch(function (err) {
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert('无法更新提醒状态：' + (err && err.message ? err.message : err));
            }
            if (button) button.disabled = false;
        });
    }

    function loadAnimeLastRunSummary(view) {
        return window.ApiClient.getJSON(window.ApiClient.getUrl('HomeScreenCompanionAnime/Anime/LastRunSummary'))
            .then(function (summary) {
                renderAnimeCards(view, summary);
                return summary;
            })
            .catch(function () {
                renderAnimeCards(view, null);
                var empty = view.querySelector('#animeCardEmpty');
                if (empty) {
                    empty.style.display = '';
                    empty.textContent = '合集结果暂时无法加载。可刷新页面或稍后再试；不影响你改设置。';
                }
            });
    }

    function saveAnimeFieldsThen(view) {
        return window.ApiClient.getPluginConfiguration(pluginId).then(function (current) {
            var ui = getUiConfig(view, false);
            current.AnimeEnabled = ui.AnimeEnabled;
            current.AnimeDryRun = ui.AnimeDryRun;
            current.AnimeIncludeSpinOffs = ui.AnimeIncludeSpinOffs;
            current.AnimeSkipWriteWhenReminders = !!ui.AnimeSkipWriteWhenReminders;
            current.AnimeCollectionPrefix = ui.AnimeCollectionPrefix;
            current.AnimeMaxRequestsPerRun = ui.AnimeMaxRequestsPerRun;
            current.AnimeCollectionRulesJson = ui.AnimeCollectionRulesJson;
            current.AnimeApprovedCollectionKeys = ui.AnimeApprovedCollectionKeys;
            current.AnimeCollectionAliasesJson = ui.AnimeCollectionAliasesJson;
            current.AnimeMappingUrl = ui.AnimeMappingUrl;
            current.AnimeAiReviewOtherEdges = ui.AnimeAiReviewOtherEdges;
            current.AnimeAiNamingEnabled = ui.AnimeAiNamingEnabled;
            current.AnimeAiCollectionReviewEnabled = ui.AnimeAiCollectionReviewEnabled;
            current.AnimeAiMaxCallsPerRun = ui.AnimeAiMaxCallsPerRun;
            current.AnimeAiMaxTokensPerCall = ui.AnimeAiMaxTokensPerCall;
            current.AnimeAiMaxTokensPerRun = ui.AnimeAiMaxTokensPerRun;
            current.AnimeAiProvider = ui.AnimeAiProvider;
            current.CompatibleAiBaseUrl = ui.CompatibleAiBaseUrl;
            current.CompatibleAiModel = ui.CompatibleAiModel;
            current.CompatibleAiApiKey = ui.CompatibleAiApiKey;
            return window.ApiClient.updatePluginConfiguration(pluginId, current).then(function (r) {
                try {
                    originalConfigState = JSON.stringify(getUiConfig(view, true));
                    checkFormState();
                    updateDryRunWarning();
                    updateAnimeGlobalDryHint(view);
                } catch (e) { }
                return r;
            });
        });
    }

    function animePostJson(path, body) {
        var tok = window.ApiClient.accessToken();
        var headers = { 'Content-Type': 'application/json' };
        if (tok) headers['X-MediaBrowser-Token'] = tok;
        return fetch(window.ApiClient.getUrl(path), {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: JSON.stringify(body || {})
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        });
    }

    function animeConfirmStripPrefix(view, name) {
        name = (name || '').trim();
        var prefixEl = view.querySelector('#txtAnimePrefix');
        var prefix = prefixEl ? (prefixEl.value || '') : '';
        if (prefix && name.indexOf(prefix) === 0) name = name.slice(prefix.length).trim();
        return name;
    }

    function animeConfirmHumanReason(card, reminders) {
        var reason = (card && card.Reason) || '';
        if (reason) return reason;
        var key = (card && card.Key) || '';
        var hit = (reminders || []).filter(function (r) {
            return r && !r.Handled && r.CollectionKey === key;
        })[0];
        if (hit && hit.Reason) return hit.Reason;
        if (hit && hit.TypeLabel) return hit.TypeLabel;
        if (card && card.HasReminder) return '需要你看一眼再决定要不要创建。';
        return '';
    }

    function openAnimeConfirmPanel(view, summary) {
        summary = summary || {};
        var overlay = view.querySelector('#animeConfirmOverlay') || document.getElementById('animeConfirmOverlay');
        if (!overlay) {
            window.Dashboard.alert('确认创建面板暂时不可用。');
            return;
        }
        var cards = (summary.Cards || []).filter(function (c) { return c && c.Key; });
        var reminders = summary.ReminderItems || [];
        var items = cards.map(function (c) {
            return {
                key: c.Key || '',
                name: animeConfirmStripPrefix(view, c.Name || ''),
                fullName: c.Name || '',
                status: c.Status || '',
                reason: animeConfirmHumanReason(c, reminders),
                memberTitles: (c.MemberTitles || []).slice(),
                memberIncludeIds: (c.MemberIncludeIds || []).slice(),
                moreCount: c.MoreCount || 0,
                hasReminder: !!c.HasReminder,
                discarded: false,
                excluded: {},
                membersExpanded: false
            };
        });
        view._animeConfirm = { items: items, sessionDiscarded: 0 };
        renderAnimeConfirmPanel(view);
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
    }

    function closeAnimeConfirmPanel(view) {
        var overlay = view.querySelector('#animeConfirmOverlay') || document.getElementById('animeConfirmOverlay');
        if (overlay) {
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
        }
    }

    function animeConfirmCounts(state) {
        var items = (state && state.items) || [];
        var active = items.filter(function (i) { return !i.discarded; });
        var n = 0, m = 0, k = 0;
        active.forEach(function (i) {
            if (i.status === 'will_create' || i.status === 'created') n++;
            else if (i.status === 'will_update' || i.status === 'updated') m++;
            if (i.hasReminder || i.status === 'skipped' || i.reason) k++;
        });
        var d = items.filter(function (i) { return i.discarded; }).length;
        return { create: n, update: m, doubt: k, discarded: d, active: active.length };
    }

    function animeConfirmIsDoubt(item) {
        return !!(item.hasReminder || item.status === 'skipped' || (item.reason && item.reason.length));
    }

    function renderAnimeConfirmPanel(view) {
        var state = view._animeConfirm;
        if (!state) return;
        var counts = animeConfirmCounts(state);
        var summaryEl = view.querySelector('#animeConfirmSummary') || document.getElementById('animeConfirmSummary');
        if (summaryEl) {
            summaryEl.textContent = '将新建 ' + counts.create + ' · 将更新 ' + counts.update +
                ' · 有疑问 ' + counts.doubt + ' · 已废弃 ' + counts.discarded;
        }
        var doubtTitle = view.querySelector('#animeConfirmDoubtTitle') || document.getElementById('animeConfirmDoubtTitle');
        var okTitle = view.querySelector('#animeConfirmOkTitle') || document.getElementById('animeConfirmOkTitle');
        var doubtList = view.querySelector('#animeConfirmDoubtList') || document.getElementById('animeConfirmDoubtList');
        var okList = view.querySelector('#animeConfirmOkList') || document.getElementById('animeConfirmOkList');
        var doubtItems = state.items.filter(function (i) { return !i.discarded && animeConfirmIsDoubt(i); });
        var okItems = state.items.filter(function (i) { return !i.discarded && !animeConfirmIsDoubt(i); });
        if (doubtTitle) doubtTitle.textContent = '有疑问（' + doubtItems.length + '）';
        if (okTitle) okTitle.textContent = '没问题 · 其余 ' + okItems.length + ' 个合集';
        function buildList(el, list, collapsedDefault) {
            if (!el) return;
            el.innerHTML = '';
            if (!list.length) {
                var empty = document.createElement('div');
                empty.className = 'fieldDescription';
                empty.textContent = '这里暂时没有合集。';
                el.appendChild(empty);
                return;
            }
            list.forEach(function (item) {
                el.appendChild(buildAnimeConfirmItem(view, item));
            });
        }
        buildList(doubtList, doubtItems);
        buildList(okList, okItems);
        var okSection = view.querySelector('#animeConfirmOkSection') || document.getElementById('animeConfirmOkSection');
        if (okSection) okSection.style.display = okItems.length ? '' : 'none';
        var doubtSection = view.querySelector('#animeConfirmDoubtSection') || document.getElementById('animeConfirmDoubtSection');
        if (doubtSection) doubtSection.style.display = doubtItems.length ? '' : 'none';
        var toggle = view.querySelector('#btnAnimeConfirmToggleOk') || document.getElementById('btnAnimeConfirmToggleOk');
        if (toggle && okList) {
            var open = okList.style.display !== 'none';
            toggle.textContent = open ? '收起' : '展开';
        }
    }

    function buildAnimeConfirmItem(view, item) {
        var wrap = document.createElement('div');
        wrap.className = 'anime-confirm-item' + (item.discarded ? ' discarded' : '');
        var top = document.createElement('div');
        top.className = 'anime-confirm-item-top';
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = item.name || '';
        nameInput.setAttribute('aria-label', '合集显示名');
        nameInput.addEventListener('input', function () { item.name = nameInput.value; });
        var discardBtn = document.createElement('button');
        discardBtn.type = 'button';
        discardBtn.className = 'anime-confirm-discard-btn';
        discardBtn.textContent = item.discarded ? '已废弃' : '废弃';
        discardBtn.disabled = !!item.discarded;
        discardBtn.addEventListener('click', function () { discardAnimeConfirmItem(view, item); });
        top.appendChild(nameInput);
        top.appendChild(discardBtn);
        wrap.appendChild(top);
        if (item.reason) {
            var reason = document.createElement('div');
            reason.className = 'anime-confirm-reason';
            reason.textContent = item.reason;
            wrap.appendChild(reason);
        }
        var members = document.createElement('div');
        members.className = 'anime-confirm-members';
        var titles = item.memberTitles || [];
        var show = titles.slice(0, item.membersExpanded ? titles.length : 4);
        var text = show.join('、');
        var hidden = titles.length - show.length + (item.moreCount || 0);
        if (!item.membersExpanded && (titles.length > 4 || (item.moreCount || 0) > 0)) {
            var rest = Math.max(0, titles.length - 4) + (item.moreCount || 0);
            if (text) text += '；';
            text += '还有 ' + rest + ' 部';
        }
        var line = document.createElement('div');
        line.textContent = text || ('共 ' + ((titles.length) + (item.moreCount || 0) || 0) + ' 部');
        members.appendChild(line);
        if (titles.length > 4 || (item.moreCount || 0) > 0) {
            var moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.textContent = item.membersExpanded ? '收起成员' : '展开成员';
            moreBtn.addEventListener('click', function () {
                item.membersExpanded = !item.membersExpanded;
                renderAnimeConfirmPanel(view);
            });
            members.appendChild(moreBtn);
        }
        wrap.appendChild(members);
        var ids = item.memberIncludeIds || [];
        if (ids.length && titles.length) {
            var checks = document.createElement('div');
            checks.className = 'anime-confirm-member-checks';
            var limit = item.membersExpanded ? titles.length : Math.min(titles.length, 8);
            for (var i = 0; i < limit; i++) {
                var id = ids[i];
                if (!id) continue;
                var lab = document.createElement('label');
                var chk = document.createElement('input');
                chk.type = 'checkbox';
                chk.checked = !item.excluded[id];
                (function (includeId) {
                    chk.addEventListener('change', function () {
                        if (chk.checked) delete item.excluded[includeId];
                        else item.excluded[includeId] = true;
                    });
                })(id);
                var span = document.createElement('span');
                span.textContent = titles[i] || '作品';
                lab.appendChild(chk);
                lab.appendChild(span);
                checks.appendChild(lab);
            }
            wrap.appendChild(checks);
        }
        return wrap;
    }

    function discardAnimeConfirmItem(view, item) {
        if (!item || item.discarded || !item.key) return;
        animePostJson('HomeScreenCompanionAnime/Anime/Discard', { Key: item.key }).then(function (data) {
            if (!data || !data.Success) {
                window.Dashboard.alert((data && data.Message) || '废弃失败。');
                return;
            }
            item.discarded = true;
            renderAnimeConfirmPanel(view);
        }).catch(function (err) {
            window.Dashboard.alert('废弃失败：' + (err && err.message ? err.message : err));
        });
    }

    function waitAnimeTaskIdle(view, timeoutMs) {
        timeoutMs = timeoutMs || 20 * 60 * 1000;
        var started = Date.now();
        function once() {
            return window.ApiClient.getJSON(window.ApiClient.getUrl('HomeScreenCompanionAnime/Anime/Status'))
                .then(function (st) {
                    refreshStatus(view);
                    if (st && st.IsRunning) {
                        if (Date.now() - started > timeoutMs) {
                            throw new Error('同步时间较长，请稍后再看结果。');
                        }
                        return new Promise(function (resolve) {
                            setTimeout(function () { resolve(once()); }, 2000);
                        });
                    }
                    return st;
                });
        }
        // brief delay so queued task can flip IsRunning
        return new Promise(function (resolve) { setTimeout(resolve, 800); }).then(once);
    }

    function submitAnimeConfirmCreate(view) {
        var state = view._animeConfirm;
        if (!state) return;
        var renames = {};
        var overrides = {};
        var discardKeys = [];
        state.items.forEach(function (item) {
            if (item.discarded) {
                discardKeys.push(item.key);
                return;
            }
            var name = (item.name || '').trim();
            if (name) renames[item.key] = name;
            var ids = item.memberIncludeIds || [];
            var excluded = item.excluded || {};
            var hasExclude = false;
            var kept = [];
            ids.forEach(function (id) {
                if (excluded[id]) hasExclude = true;
                else kept.push(id);
            });
            if (hasExclude && kept.length) overrides[item.key] = kept;
        });
        var btn = view.querySelector('#btnAnimeConfirmCreate') || document.getElementById('btnAnimeConfirmCreate');
        if (btn) btn.disabled = true;
        animePostJson('HomeScreenCompanionAnime/Anime/ConfirmCreate', {
            Renames: renames,
            DiscardKeys: discardKeys,
            MemberOverrides: overrides
        }).then(function (data) {
            if (!data || !data.Success) {
                window.Dashboard.alert((data && data.Message) || '无法开始创建。');
                if (btn) btn.disabled = false;
                return null;
            }
            closeAnimeConfirmPanel(view);
            return waitAnimeTaskIdle(view).then(function () {
                return loadAnimeLastRunSummary(view);
            });
        }).catch(function (err) {
            window.Dashboard.alert('创建失败：' + (err && err.message ? err.message : err));
        }).then(function () {
            if (btn) btn.disabled = false;
        });
    }

    function runAnimeCollectionTask(view) {
        var enabled = view.querySelector('#chkAnimeEnabled');
        if (enabled && !enabled.checked) {
            window.Dashboard.alert('请先启用动漫合集。');
            return;
        }
        try { validateAnimePolicy(view); } catch (error) { alert(error.message); return; }
        syncAnimeCheckboxFromScheduled(view);
        var btn = view.querySelector('#btnAnimeRunNow');
        if (btn) { btn.disabled = true; }
        saveAnimeFieldsThen(view).then(function () {
            return animePostJson('HomeScreenCompanionAnime/Anime/ManualPreview', {});
        }).then(function (data) {
            if (!data || !data.Success) {
                window.Dashboard.alert((data && data.Message) || '无法开始预览。');
                return null;
            }
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert('正在预览，完成后会打开确认创建。');
            }
            return waitAnimeTaskIdle(view).then(function () {
                return window.ApiClient.getJSON(window.ApiClient.getUrl('HomeScreenCompanionAnime/Anime/LastRunSummary'));
            }).then(function (summary) {
                openAnimeConfirmPanel(view, summary);
                return summary;
            });
        }).catch(function (err) {
            window.Dashboard.alert('无法启动同步：' + (err && err.message ? err.message : err));
        }).then(function () {
            if (btn) btn.disabled = false;
        });
    }

    function switchToAnimeTab(view) {
        var btn = view.querySelector('.page-tab-btn[data-page-tab="AnimeCollections"]');
        if (btn) btn.click();
    }

    function refreshStatus(view) {
        var myId = ++statusRequestId;
        Promise.all([
            window.ApiClient.getJSON(window.ApiClient.getUrl("HomeScreenCompanionAnime/Status")),
            window.ApiClient.getJSON(window.ApiClient.getUrl("HomeScreenCompanionAnime/Hsc/Status")).catch(function () { return null; }),
            window.ApiClient.getJSON(window.ApiClient.getUrl("HomeScreenCompanionAnime/TopList/Status")).catch(function () { return null; }),
            window.ApiClient.getJSON(window.ApiClient.getUrl("HomeScreenCompanionAnime/Anime/Status")).catch(function () { return null; })
        ]).then(function (results) {
            if (myId !== statusRequestId) return;
            var result = results[0], hscResult = results[1], tlResult = results[2], animeResult = results[3];
            var label = view.querySelector('#lastRunStatusLabel'), dot = view.querySelector('#dotStatus'), content = view.querySelector('#logContent');
            var btnSave = view.querySelector('.btn-save'), btnRun = view.querySelector('#btnRunSync');

            var eitherRunning = result.IsRunning || (hscResult && hscResult.IsRunning) || (animeResult && animeResult.IsRunning);
            if (eitherRunning) {
                if (btnSave) { btnSave.disabled = true; btnSave.style.opacity = "0.5"; btnSave.querySelector('span').textContent = "正在同步..."; }
                if (btnRun) btnRun.disabled = true;
            } else {
                if (btnRun) btnRun.disabled = false;
                if (btnSave) {
                    btnSave.querySelector('span').textContent = "保存设置";
                    checkFormState();
                }
            }

            if (label) label.textContent = displayRunStatus(result.LastRunStatus);
            if (dot) {
                dot.className = "status-dot";
                var st = result.LastRunStatus || '';
                if (st.includes("Running")) dot.classList.add("running");
                else if (/failed|error/i.test(st)) dot.classList.add("failed");
                else if (/warning/i.test(st)) dot.classList.add("warn");
            }

            _lastStatus = { sync: result, hsc: hscResult, tl: tlResult, anime: animeResult };
            var animeLabel = view.querySelector('#animeLastRunStatusLabel');
            var animeDot = view.querySelector('#animeDotStatus');
            if (animeLabel && animeResult) {
                // Anime LastStatus is already Chinese — do not run English displayRunStatus regex.
                animeLabel.textContent = animeResult.LastRunStatus || '尚未运行';
            }
            if (animeDot && animeResult) {
                animeDot.className = 'status-dot';
                var ast = animeResult.LastRunStatus || '';
                if (animeResult.IsRunning || /正在运行/.test(ast)) animeDot.classList.add('running');
                else if (/失败|错误/.test(ast)) animeDot.classList.add('failed');
                else if (/等待|警告/.test(ast)) animeDot.classList.add('warn');
            }
            var animeRunBtn = view.querySelector('#btnAnimeRunNow');
            if (animeRunBtn && animeResult) animeRunBtn.disabled = !!animeResult.IsRunning;
            var animeTab = view.querySelector('#tabAnimeCollections');
            var animeVisible = animeTab && animeTab.style.display !== 'none';
            var wasRunning = !!(view._animeWasRunning);
            var nowRunning = !!(animeResult && animeResult.IsRunning);
            view._animeWasRunning = nowRunning;
            if (animeVisible && (!nowRunning) && (wasRunning || !view._animeSummaryLoaded)) {
                view._animeSummaryLoaded = true;
                loadAnimeLastRunSummary(view);
            }
            updateAnimeGlobalDryHint(view);
            if (content) renderLogModal(view);
        }).catch(function () {
            if (myId !== statusRequestId) return;
        });
    }

    function sortRows(container, criteria) {
        var rows = Array.from(container.querySelectorAll('.tag-row'));

        rows.sort((a, b) => {
            if (criteria === 'Name') {
                var na = (a.querySelector('.txtEntryLabel').value || a.querySelector('.txtTagName').value).toLowerCase();
                var nb = (b.querySelector('.txtEntryLabel').value || b.querySelector('.txtTagName').value).toLowerCase();
                return na.localeCompare(nb);
            }
            if (criteria === 'Active') {
                var aa = a.querySelector('.chkTagActive').checked ? 1 : 0;
                var bb = b.querySelector('.chkTagActive').checked ? 1 : 0;
                return bb - aa;
            }
            if (criteria === 'LatestEdited') {
                var da = new Date(a.dataset.lastModified || 0).getTime();
                var db = new Date(b.dataset.lastModified || 0).getTime();
                return db - da;
            }
            return parseInt(a.dataset.index) - parseInt(b.dataset.index);
        });

        rows.forEach(row => container.appendChild(row));

        if (criteria !== 'Manual') container.classList.add('sort-hidden');
        else container.classList.remove('sort-hidden');
    }

    // ---- Home Section Tab helpers ----
    var _hseUsersCache = null;
    function getHseUsers() {
        if (_hseUsersCache) return Promise.resolve(_hseUsersCache);
        return window.ApiClient.getJSON(window.ApiClient.getUrl('Users', { IsDisabled: false }))
            .then(function(users) {
                _hseUsersCache = (users || []).map(function(u) { return { Id: u.Id, Name: u.Name }; });
                return _hseUsersCache;
            });
    }

    // "Select all" row for a list of user checkboxes. Its checkbox has no value, and the
    // hsc-select-all class keeps it out of every selector that reads the chosen users.
    function buildSelectAllRowHtml(rowClass) {
        return '<div class="' + (rowClass || 'checkboxContainer') + ' hsc-select-all-row" style="margin:2px 0 4px;padding-bottom:4px;border-bottom:1px solid var(--line-color,rgba(128,128,128,0.2));">' +
            '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;width:100%;">' +
            '<input type="checkbox" is="emby-checkbox" class="hsc-select-all" />' +
            '<span style="font-weight:600;">全选</span></label></div>';
    }

    // Wires the select-all box in container to the checkboxes matching itemSelector. Each box
    // it flips fires its own change event, so dirty checks and button states react as if the
    // user had clicked it. Disabled boxes (the Home Screen Sync source user) are left alone.
    // Returns a function that re-reads the state after boxes were changed from code.
    function wireSelectAll(container, itemSelector) {
        var all = container && container.querySelector('.hsc-select-all');
        if (!all) return function () {};
        function items() {
            return Array.from(container.querySelectorAll(itemSelector)).filter(function (c) { return !c.disabled; });
        }
        function sync() {
            var list = items();
            var n = list.filter(function (c) { return c.checked; }).length;
            all.checked = list.length > 0 && n === list.length;
            all.indeterminate = n > 0 && n < list.length;
        }
        all.addEventListener('change', function () {
            var want = all.checked;
            items().forEach(function (c) {
                if (c.checked === want) return;
                c.checked = want;
                c.dispatchEvent(new Event('change', { bubbles: true }));
            });
            sync();
        });
        container.addEventListener('change', function (e) {
            if (e.target !== all && e.target.matches && e.target.matches(itemSelector)) sync();
        });
        sync();
        return sync;
    }

    function buildUserMultiSelectHtml(users, selectedIds, checkboxClass) {
        function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
        function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        if (!users || users.length === 0) return '<em style="opacity:0.5">未找到用户</em>';
        var sel = selectedIds || [];
        var rows = buildSelectAllRowHtml() + users.map(function(u) {
            var chk = sel.indexOf(u.Id) !== -1 ? ' checked' : '';
            return '<div class="checkboxContainer" style="margin:2px 0;">' +
                '<label><input type="checkbox" is="emby-checkbox" class="' + escAttr(checkboxClass) + '" value="' + escAttr(u.Id) + '" data-name="' + escAttr(u.Name) + '"' + chk + '>' +
                '<span>' + escHtml(u.Name) + '</span></label></div>';
        }).join('');
        var checkedNames = users.filter(function(u) { return sel.indexOf(u.Id) !== -1; }).map(function(u) { return u.Name; });
        var lbl = checkedNames.length === 0 ? '未选择用户'
            : checkedNames.length === users.length ? '所有用户'
            : checkedNames.join(', ');
        var btnStyle = 'display:flex;align-items:center;width:100%;padding:6px 10px;' +
            'background:var(--plugin-input-bg,rgba(128,128,128,0.08));' +
            'border:1px solid var(--plugin-input-border,var(--line-color));' +
            'border-radius:4px;font-size:0.9em;color:inherit;cursor:pointer;' +
            'box-sizing:border-box;text-align:left;';
        return '<div class="filter-dropdown-wrapper hsc-user-dropdown" style="width:100%;">' +
            '<button type="button" class="hsc-user-dropdown-btn" style="' + btnStyle + '">' +
            '<span class="hsc-user-dropdown-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(lbl) + '</span>' +
            '<i class="md-icon hsc-user-dropdown-caret" style="font-size:1em;margin-left:6px;flex-shrink:0;">expand_more</i>' +
            '</button>' +
            '<div class="filter-dropdown-panel" style="min-width:220px;width:100%;box-sizing:border-box;">' + rows + '</div>' +
            '</div>';
    }

    function wireUserMultiSelect(container) {
        var wrapper = container && container.querySelector('.hsc-user-dropdown');
        if (!wrapper) return;
        var btn    = wrapper.querySelector('.hsc-user-dropdown-btn');
        var panel  = wrapper.querySelector('.filter-dropdown-panel');
        var lbl    = wrapper.querySelector('.hsc-user-dropdown-label');
        var caret  = wrapper.querySelector('.hsc-user-dropdown-caret');
        var userBoxSelector = 'input[type="checkbox"]:not(.hsc-select-all)';
        function updateLabel() {
            var allBoxes     = panel.querySelectorAll(userBoxSelector);
            var checkedBoxes = panel.querySelectorAll(userBoxSelector + ':checked');
            if (checkedBoxes.length === 0) {
                lbl.textContent = '未选择用户';
            } else if (checkedBoxes.length === allBoxes.length) {
                lbl.textContent = '所有用户';
            } else {
                lbl.textContent = Array.from(checkedBoxes).map(function(cb) {
                    return cb.dataset.name || '';
                }).join(', ');
            }
        }
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var open = panel.classList.toggle('open');
            caret.textContent = open ? 'expand_less' : 'expand_more';
        });
        panel.querySelectorAll(userBoxSelector).forEach(function(chk) {
            chk.addEventListener('change', updateLabel);
        });
        wireSelectAll(panel, userBoxSelector);
        document.addEventListener('click', function closeUserDrop(e) {
            if (!wrapper.isConnected) { document.removeEventListener('click', closeUserDrop); return; }
            if (!panel.contains(e.target) && e.target !== btn) {
                panel.classList.remove('open');
                caret.textContent = 'expand_more';
            }
        });
    }

    var _hseLibraryCachePromise = null;
    function preFetchLibraryData() {
        if (_hseLibraryCachePromise) return _hseLibraryCachePromise;
        var tok = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
        _hseLibraryCachePromise = Promise.all([
            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/List'), { headers: { 'X-MediaBrowser-Token': tok } })
                .then(function(r) { return r.json(); }).catch(function() { return { FolderNames: [] }; }),
            fetch(window.ApiClient.getUrl('Library/VirtualFolders'), { headers: { 'X-MediaBrowser-Token': tok } })
                .then(function(r) { return r.json(); }).catch(function() { return []; })
        ]).then(function(results) {
            return {
                topListFolderNames: new Set((results[0].FolderNames || []).map(function(n) { return n.toLowerCase(); })),
                virtualFolders: results[1] || []
            };
        }).catch(function() {
            _hseLibraryCachePromise = null; // tillåt omförsök vid fel
            return { topListFolderNames: new Set(), virtualFolders: [] };
        });
        return _hseLibraryCachePromise;
    }



    function buildHomeSectionFormHtml(savedSettings, defaultSectionType, defaultName, tagEnabled, collEnabled, libraryOptions, savedLibraryId, allLibraries) {
        var s = savedSettings || {};
        var html = '';

        var st = s.SectionType || defaultSectionType || (collEnabled ? 'boxset' : 'items');
        html += '<div style="margin-bottom:12px;"><label class="selectLabel">栏目类型</label>';
        html += '<select is="emby-select" class="selHseSectionType hse-field-str" data-field="SectionType" style="width:100%;">';
        var sectionTypeOptions = [];
        if (collEnabled) sectionTypeOptions.push(['boxset', '单个合集']);
        if (tagEnabled)  sectionTypeOptions.push(['items',  '动态媒体（标签）']);
        sectionTypeOptions.forEach(function(o) {
            html += '<option value="' + o[0] + '"' + (st === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        });
        html += '</select></div>';

        var displayModeVal = s.DisplayMode || '';
        html += '<div style="margin-bottom:12px;"><label class="selectLabel">显示此栏目</label>';
        html += '<select is="emby-select" class="hse-field-str" data-field="DisplayMode" style="width:100%;">';
        html += '<option value=""'              + (displayModeVal === ''               ? ' selected' : '') + '>始终</option>';
        html += '<option value="tv"'            + (displayModeVal === 'tv'             ? ' selected' : '') + '>电视模式开启时</option>';
        html += '<option value="mobile,desktop"'+ (displayModeVal === 'mobile,desktop' ? ' selected' : '') + '>电视模式关闭时</option>';
        html += '</select></div>';

        var savedItemTypes = [];
        try { savedItemTypes = JSON.parse(s.ItemTypes || '[]'); } catch {}
        var savedItemTypesStr = savedItemTypes.length > 0 ? savedItemTypes.join(',') : 'Movie,Series';
        html += '<div class="hse-items-only" style="margin-bottom:12px;"><label class="selectLabel">媒体类型</label>';
        html += '<select is="emby-select" class="selHseItemTypes" style="width:100%;">';
        var itemTypeOptions = [
                ['Movie',        '电影'],
                ['Series',       '剧集'],
                ['Movie,Series', '电影和剧集'],
                ['Episode',      '单集'],
                ['BoxSet',       '合集'],
                ['MusicVideo',   '音乐视频'],
                ['Video',        '视频'],
                ['Photo',        '照片'],
                ['Program',      '节目'],
                ['TvChannel',    '直播电视频道'],
                ['MusicAlbum',   '音乐专辑'],
                ['MusicArtist',  '艺术家'],
                ['Audio',        '歌曲'],
                ['AudioBook',    '有声读物'],
                ['Trailer',      '预告片'],
                ['Game',         '游戏'],
                ['Book',         '图书']
              ];
        itemTypeOptions.forEach(function(o) {
            html += '<option value="' + o[0] + '"' + (savedItemTypesStr === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        });
        html += '</select></div>';

        var customName = (s.CustomName || '').replace(/"/g, '&quot;');
        var customNamePlaceholder = (defaultName || '').replace(/"/g, '&quot;');
        html += '<div style="margin-bottom:12px;"><input is="emby-input" type="text" class="hse-field-str" data-field="CustomName" label="自定义标题" value="' + customName + '" placeholder="' + customNamePlaceholder + '"/></div>';

        // Emby native uses "" for Cards (default); migrate old stored "cards" value
        var viewTypeVal = (s.ViewType === 'cards' ? '' : s.ViewType) || '';
        html += '<div class="hse-items-only" style="margin-bottom:12px;"><label class="selectLabel">视图类型</label>';
        html += '<select is="emby-select" class="selHseViewType hse-field-str" data-field="ViewType" style="width:100%;">';
        [['','卡片（默认）'],['spotlight','聚焦']].forEach(function(o) {
            html += '<option value="' + o[0] + '"' + (viewTypeVal === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        });
        html += '</select></div>';

        var imgTypeVal = s.ImageType || '';
        var imgTypeDisabled = viewTypeVal === 'spotlight';
        html += '<div style="margin-bottom:12px;"><label class="selectLabel">图片类型</label>';
        html += '<select is="emby-select" class="selHseImageType hse-field-str" data-field="ImageType" style="width:100%;"' + (imgTypeDisabled ? ' disabled' : '') + '><option value=""' + (imgTypeVal === '' ? ' selected' : '') + '>自动</option>';
        ['Primary','Thumb'].forEach(function(o) { html += '<option value="' + o + '"' + (imgTypeVal === o ? ' selected' : '') + '>' + ({Primary:'主图',Thumb:'缩略图'}[o]) + '</option>'; });
        html += '</select></div>';

        var sortByVal = s.SortBy || '';
        html += '<div style="margin-bottom:12px;"><label class="selectLabel">排序依据</label>';
        html += '<select is="emby-select" class="hse-field-str" data-field="SortBy" style="width:100%;">';
        html += '<option value=""' + (sortByVal === '' ? ' selected' : '') + '>（默认）</option>';
        [
            ['CommunityRating,SortName',            '评分'],
            ['DateCreated,SortName',                '添加日期'],
            ['SortName',                            '名称'],
            ['Runtime,SortName',                    '时长'],
            ['ProductionYear,PremiereDate,SortName','发行日期'],
            ['ProductionYear,SortName',             '年份'],
            ['Random',                              '随机']
        ].forEach(function(o) {
            html += '<option value="' + o[0] + '"' + (sortByVal === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        });
        html += '</select></div>';

        var sortOrderVal = s.SortOrder || '';
        html += '<div style="margin-bottom:12px;"><label class="selectLabel">排序顺序</label>';
        html += '<select is="emby-select" class="hse-field-str" data-field="SortOrder" style="width:100%;">';
        html += '<option value=""' + (sortOrderVal === '' ? ' selected' : '') + '>（默认）</option>';
        [['Ascending','升序'],['Descending','降序']].forEach(function(o) { html += '<option value="' + o[0] + '"' + (sortOrderVal === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
        html += '</select></div>';

        var dispModeVal = s.ScrollDirection || '';
        html += '<div style="margin-bottom:12px;"><label class="selectLabel">滚动方向</label>';
        html += '<select is="emby-select" class="hse-field-str" data-field="ScrollDirection" style="width:100%;"><option value="">（自动）</option>';
        [['Horizontal','水平'],['Vertical','垂直']].forEach(function(o) { html += '<option value="' + o[0] + '"' + (dispModeVal === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
        html += '</select></div>';

        var playstateVal = s._queryIsPlayed || '';
        html += '<div class="hse-items-only" style="margin-bottom:12px;"><label class="selectLabel">播放状态</label>';
        html += '<select is="emby-select" class="hse-field-str" data-field="_queryIsPlayed" style="width:100%;">';
        html += '<option value=""' + (playstateVal === '' ? ' selected' : '') + '>不限</option>';
        [['true','已播放'],['false','未播放']].forEach(function(o) { html += '<option value="' + o[0] + '"' + (playstateVal === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
        html += '</select></div>';

        // Hidden library selector — used only for boxset type (preserves the collection library ID).
        var curLibId = savedLibraryId || 'auto';
        html += '<select class="selHseLibrary" style="display:none;">';
        html += '<option value="auto"' + (curLibId === 'auto' ? ' selected' : '') + '>自动</option>';
        (libraryOptions || []).forEach(function (lib) {
            html += '<option value="' + lib.id + '"' + (curLibId === lib.id ? ' selected' : '') + '>' + lib.name + '</option>';
        });
        html += '</select>';

        // Multi-library checkboxes for items type.
        // Excluded IDs are stored in HomeSectionSettings._queryExcludeViewIds → Query.ExcludeUserViewIds in Emby.
        // Checked = include (not excluded), unchecked = exclude.
        if (st !== 'boxset' && (allLibraries || []).length > 0) {
            var excludedIds = new Set();
            try {
                var raw = (s._queryExcludeViewIds || '').split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x; });
                raw.forEach(function(id) { excludedIds.add(id); });
            } catch {}
            // Om inga explicita exkluderingar sparats (ny sektion eller legacy), exkludera alla top-list-bibliotek.
            // Bakåtkompatibelt: befintliga grupper utan _queryExcludeViewIds får top-list auto-avbockat.
            if (excludedIds.size === 0) {
                (allLibraries || []).forEach(function(lib) {
                    if (lib.isTopList) excludedIds.add(lib.id);
                });
            }
            // Hidden checkboxes — library exclusions managed automatically under the hood
            html += '<div style="display:none;">';
            (allLibraries || []).forEach(function (lib) {
                var isChecked = !excludedIds.has(lib.id);
                html += '<input type="checkbox" class="chkHseLibrary" value="' + lib.id + '"' + (isChecked ? ' checked' : '') + '/>';
            });
            html += '</div>';
        }

        return html;
    }

    function updateHseItemsOnlyVisibility(tab) {
        var stSel = tab.querySelector('.selHseSectionType');
        var isItems = !stSel || stSel.value !== 'boxset';
        tab.querySelectorAll('.hse-items-only').forEach(function(el) {
            el.style.display = isItems ? '' : 'none';
        });
    }

    function updateHseImageTypeState(tab) {
        var stSel = tab.querySelector('.selHseSectionType');
        var vtSel = tab.querySelector('.selHseViewType');
        var imgSel = tab.querySelector('.selHseImageType');
        if (!imgSel) return;
        var isItems = !stSel || stSel.value !== 'boxset';
        var isCards = !vtSel || vtSel.value === '' || vtSel.value === 'cards';
        imgSel.disabled = isItems && !isCards;
    }

    function wireHomeSectionTypeChange(tab) {
        var stSel = tab.querySelector('.selHseSectionType');
        if (!stSel) return;
        updateHseItemsOnlyVisibility(tab);
        updateHseImageTypeState(tab);
        stSel.addEventListener('change', function() {
            updateHseItemsOnlyVisibility(tab);
            updateHseImageTypeState(tab);
        });
        var vtSel = tab.querySelector('.selHseViewType');
        if (vtSel) {
            vtSel.addEventListener('change', function() {
                updateHseImageTypeState(tab);
            });
        }
    }

    // Hämta live ContentSection från Emby och spegla värdena i formuläret.
    // Returns a Promise that resolves when sync is complete (or immediately if no tracked section).
    function syncHomeSectionFromEmby(tab) {
        var tracked = [];
        try { tracked = JSON.parse(decodeURIComponent(tab.dataset.hseTracked || '%5B%5D')); } catch {}
        var entry = tracked.find(function(t) { return t.SectionId && !t.SectionId.startsWith('hsc__'); });
        if (!entry) return Promise.resolve();

        var syncHeaders = {};
        var syncToken = window.ApiClient && window.ApiClient.accessToken && window.ApiClient.accessToken();
        if (syncToken) syncHeaders['X-Emby-Token'] = syncToken;
        var syncUrl = window.ApiClient
            ? window.ApiClient.getUrl('HomeScreenCompanionAnime/Hsc/UserSections', { UserId: entry.UserId })
            : '/HomeScreenCompanionAnime/Hsc/UserSections?UserId=' + encodeURIComponent(entry.UserId);

        return fetch(syncUrl, { headers: syncHeaders })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var sections = (data && data.Sections) || [];
                var section = sections.find(function(s) { return s.Id === entry.SectionId; });
                if (!section) return;

                // Fält som kan läsas tillbaka från Emby och ha ett formulärfält
                var fieldMap = {
                    SectionType:     section.SectionType || '',
                    CustomName:      section.CustomName || '',
                    DisplayMode:     section.DisplayMode || '',
                    ViewType:        section.ViewType || '',
                    ImageType:       section.ImageType || '',
                    SortBy:          section.SortBy || '',
                    SortOrder:       section.SortOrder || '',
                    ScrollDirection: (function() {
                        var sd = section.ScrollDirection;
                        if (sd === null || sd === undefined) return '';
                        if (typeof sd === 'number') return sd === 0 ? 'Horizontal' : sd === 1 ? 'Vertical' : '';
                        return String(sd);
                    })(),
                    '_queryIsPlayed': (section.Query != null && section.Query.IsPlayed === true) ? 'true'
                                    : (section.Query != null && (section.Query.IsUnplayed === true || section.Query.IsPlayed === false)) ? 'false'
                                    : ''
                };

                Object.keys(fieldMap).forEach(function(field) {
                    var el = tab.querySelector('[data-field="' + field + '"]');
                    if (!el) return;
                    var val = fieldMap[field];
                    if (el.tagName === 'SELECT') {
                        for (var i = 0; i < el.options.length; i++) {
                            if (el.options[i].value === val) { el.selectedIndex = i; break; }
                        }
                    } else {
                        el.value = val;
                    }
                });

                // Sync ItemTypes dropdown separately (not a data-field element)
                var itemTypesSel = tab.querySelector('.selHseItemTypes');
                if (itemTypesSel && section.ItemTypes && section.ItemTypes.length > 0) {
                    var itemTypesStr = section.ItemTypes.join(',');
                    for (var i = 0; i < itemTypesSel.options.length; i++) {
                        if (itemTypesSel.options[i].value === itemTypesStr) { itemTypesSel.selectedIndex = i; break; }
                    }
                }

                // Sync library checkboxes från Emby's ContentSection.ExcludedFolders (källan till sanning).
                // Om Emby returnerar en array (även tom) används den — annars behålls UI:ts nuvarande state.
                console.log('[HSC] syncHomeSectionFromEmby 排除文件夹：', section.ExcludedFolders);
                if (Array.isArray(section.ExcludedFolders)) {
                    var embyExcluded = new Set((section.ExcludedFolders || []).map(function(id) { return String(id); }));
                    tab.querySelectorAll('.chkHseLibrary').forEach(function(chk) {
                        chk.checked = !embyExcluded.has(chk.value);
                    });
                }

                updateHseItemsOnlyVisibility(tab);
                updateHseImageTypeState(tab);
            })
            .catch(function() { return undefined; }); // ignorera nätverksfel tyst
    }



    function initPlaylistTab(row) {
        var tab = row.querySelector('.playlist-tab');
        if (!tab || tab.dataset.plLoaded === '1') return;
        tab.dataset.plLoaded = '1';
        var savedUserIds = [];
        try { savedUserIds = JSON.parse(decodeURIComponent(tab.dataset.plUserids || '%5B%5D')); } catch {}
        getHseUsers().then(function(users) {
            var listEl = tab.querySelector('.playlist-user-list');
            if (!listEl) return;
            listEl.innerHTML = buildUserMultiSelectHtml(users, savedUserIds, 'chkPlaylistUser');
            wireUserMultiSelect(listEl);
        });
    }

    function initHomeSectionTab(row) {
        var tab = row.querySelector('.homescreen-tab');
        if (!tab || tab.dataset.hseLoaded === '1') return;
        tab.dataset.hseLoaded = 'loading'; // prevent re-entry while loading

        var savedUserIds = [];
        var savedSettings = {};
        try { savedUserIds = JSON.parse(decodeURIComponent(tab.dataset.hseUserids || '%5B%5D')); } catch {}
        try { savedSettings = JSON.parse(decodeURIComponent(tab.dataset.hseSettings || '%7B%7D')); } catch {}
        var defaultSectionType = tab.dataset.hseDefaultType || 'items';
        var savedLibraryId = decodeURIComponent(tab.dataset.hseLibraryid || 'auto');

        Promise.all([getHseUsers(), preFetchLibraryData()])
            .then(function(results) {
                var users = results[0];
                var topListFolderNames = results[1].topListFolderNames;
                var virtualFolders = results[1].virtualFolders;

                // Build library options for the hidden boxset selector (all non-top-list folders)
                var libraryOptions = virtualFolders
                    .filter(function (f) {
                        return !(f.Locations || []).some(function (loc) {
                            var parts = loc.replace(/\\/g, '/').split('/');
                            var folderName = parts[parts.length - 1] || parts[parts.length - 2] || '';
                            return topListFolderNames.has(folderName.toLowerCase());
                        });
                    })
                    .map(function (f) { return { id: f.ItemId, name: f.Name }; });

                // All libraries with isTopList flag for the multi-checkbox section
                var allLibraries = virtualFolders.map(function (f) {
                    var isTopList = (f.Locations || []).some(function (loc) {
                        var parts = loc.replace(/\\/g, '/').split('/');
                        var folderName = parts[parts.length - 1] || parts[parts.length - 2] || '';
                        return topListFolderNames.has(folderName.toLowerCase());
                    });
                    return { id: f.ItemId, name: f.Name, isTopList: isTopList };
                });

                // User list
                tab.querySelector('.hse-user-list-inner').innerHTML = buildUserMultiSelectHtml(users, savedUserIds, 'chkHseUser');
                wireUserMultiSelect(tab.querySelector('.hse-user-list-inner'));

                // Structured section settings form
                var defaultTagName = row.querySelector('.txtEntryLabel').value || row.querySelector('.txtTagName').value || '';
                var tagEnabled  = !!(row.querySelector('.chkEnableTag') || {}).checked;
                var collEnabled = !!(row.querySelector('.chkEnableCollection') || {}).checked;

                // Check dirty state BEFORE rendering — so we know if user had unsaved changes already
                var _hseView = document.querySelector('#HomeScreenCompanionConfigPage');
                var _wasAlreadyDirty = _hseView && originalConfigState &&
                    JSON.stringify(getUiConfig(_hseView, true)) !== originalConfigState;

                tab.querySelector('.hse-fields-inner').innerHTML = buildHomeSectionFormHtml(savedSettings, defaultSectionType, defaultTagName, tagEnabled, collEnabled, libraryOptions, savedLibraryId, allLibraries);
                wireHomeSectionTypeChange(tab);

                // Mark as fully loaded only after form is in DOM so getUiConfig reads form values
                tab.dataset.hseLoaded = '1';

                // Sync live values from Emby, then re-anchor baseline and check form state.
                // Re-anchoring happens AFTER sync so changes made by sync don't trigger a false dirty state.
                syncHomeSectionFromEmby(tab).then(function() {
                    if (!_wasAlreadyDirty && _hseView && originalConfigState) {
                        try { originalConfigState = JSON.stringify(getUiConfig(_hseView, true)); } catch {}
                    }
                    setTimeout(checkFormState, 0);
                });
            })
            .catch(function(e) {
                tab.querySelector('.hse-fields-inner').innerHTML = '<em style="color:#cc4444">加载失败：' + e.message + '</em>';
                tab.dataset.hseLoaded = '0'; // allow retry
            });
    }
    function updateHseSectionAvailability(row) {
        var tagEnabled  = !!(row.querySelector('.chkEnableTag') || {}).checked;
        var collEnabled = !!(row.querySelector('.chkEnableCollection') || {}).checked;
        var hseCbx = row.querySelector('.chkEnableHomeSection');
        if (!hseCbx) return;

        var hint = row.querySelector('.hse-disabled-hint');
        if (!tagEnabled && !collEnabled) {
            hseCbx.disabled = true;
            hseCbx.checked = false;
            if (hint) hint.style.display = 'block';
            var hseDetails = row.querySelector('.hse-details');
            if (hseDetails) hseDetails.style.display = 'none';
            updateBadges(row);
        } else {
            hseCbx.disabled = false;
            if (hint) hint.style.display = 'none';
        }

        var tab = row.querySelector('.homescreen-tab');
        if (tab && tab.dataset.hseLoaded === '1') {
            refreshHseSectionTypeOptions(tab, tagEnabled, collEnabled);
        }
    }

    function refreshHseSectionTypeOptions(tab, tagEnabled, collEnabled) {
        var stSel = tab.querySelector('.selHseSectionType');
        if (!stSel) return;
        var currentVal = stSel.value;
        stSel.innerHTML = '';
        if (collEnabled) { var o1 = document.createElement('option'); o1.value = 'boxset'; o1.textContent = '单个合集'; stSel.appendChild(o1); }
        if (tagEnabled)  { var o2 = document.createElement('option'); o2.value = 'items';  o2.textContent = '动态媒体（标签）'; stSel.appendChild(o2); }
        var stillValid = Array.from(stSel.options).some(function(o) { return o.value === currentVal; });
        if (stillValid) stSel.value = currentVal;
        updateHseItemsOnlyVisibility(tab);
    }

    // ---- End Home Section Tab helpers ----

    function validateAnimePolicy(view) {
        function fail(id, message) {
            view.querySelector(id).focus();
            throw new Error('动漫合集配置：' + message);
        }
        ['#txtAnimeAiMaxCalls', '#txtAnimeAiMaxTokensPerCall', '#txtAnimeAiMaxTokensPerRun'].forEach(function (id) {
            var text = view.querySelector(id).value.trim();
            var number = Number(text);
            if (!text || !Number.isSafeInteger(number) || number < 0)
                fail(id, 'AI 预算必须为非负整数；填 0 表示不调用 AI。');
        });
        function parse(id, label, fallback) {
            var text = view.querySelector(id).value.trim();
            if (!text) return fallback;
            try {
                var parsed = JSON.parse(text);
                // JSON.parse otherwise silently accepts duplicate object keys.
                var tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) || [];
                var objects = [];
                tokens.forEach(function (token, index) {
                    if (token === '{') objects.push(new Set());
                    else if (token === '}') objects.pop();
                    else if (token.charAt(0) === '"' && tokens[index + 1] === ':') {
                        var key = JSON.parse(token), current = objects[objects.length - 1];
                        if (current.has(key)) throw new Error('重复的 JSON 属性：' + key);
                        current.add(key);
                    }
                });
                return parsed;
            }
            catch (error) { fail(id, label + '不是有效的 JSON：' + error.message); }
        }
        function keyValid(key) {
            return typeof key === 'string' && /^anilist:[1-9][0-9]*$/.test(key) && Number(key.slice(8)) <= 2147483647;
        }
        function idValid(id) {
            if (typeof id !== 'string' || !/^(?:(?:anilist|tmdb_movie|tmdb_show|tvdb_movie|tvdb_show):[1-9][0-9]*|imdb_(?:movie|show):tt[0-9]+)$/.test(id)) return false;
            return id.indexOf('anilist:') === 0 ? Number(id.slice(8)) <= 2147483647 :
                (id.indexOf('imdb_') !== 0 || /[1-9]/.test(id.split(':tt')[1]));
        }
        var ruleField = '#txtAnimeCollectionRulesJson';
        var rules = parse(ruleField, '成员规则', []);
        if (!Array.isArray(rules)) fail(ruleField, '成员规则必须是 JSON 数组。');
        var keys = new Set(), owners = new Map();
        rules.forEach(function (rule, index) {
            var label = '第 ' + (index + 1) + ' 条规则';
            if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !keyValid(rule.Key))
                fail(ruleField, label + '的 Key 格式应为 anilist:数字，例如 anilist:12345。');
            if (keys.has(rule.Key)) fail(ruleField, '规则 Key 重复：' + rule.Key);
            keys.add(rule.Key);
            if (Object.keys(rule).some(function (key) { return ['Key', 'IncludeIds', 'ExcludeIds'].indexOf(key) < 0; }))
                fail(ruleField, label + '包含未知字段，仅支持 Key、IncludeIds、ExcludeIds。');
            if (!Array.isArray(rule.IncludeIds) || (rule.ExcludeIds !== undefined && !Array.isArray(rule.ExcludeIds)))
                fail(ruleField, label + '的 IncludeIds 必须是数组；可选的 ExcludeIds 也必须是数组。');
            rule.IncludeIds.concat(rule.ExcludeIds || []).forEach(function (id) {
                if (!idValid(id)) fail(ruleField, label + '包含无效的 ID：' + String(id));
            });
            var excluded = new Set(rule.ExcludeIds || []);
            rule.IncludeIds.forEach(function (id) {
                if (excluded.has(id)) return;
                if (owners.has(id) && owners.get(id) !== rule.Key)
                    fail(ruleField, '同一 ID 出现在两条规则中：' + id);
                owners.set(id, rule.Key);
            });
        });
        var aliasField = '#txtAnimeCollectionAliasesJson';
        var aliases = parse(aliasField, '合集别名', {});
        if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases))
            fail(aliasField, '合集别名必须是 JSON 对象。');
        Object.keys(aliases).forEach(function (key) {
            if (!keyValid(key) || typeof aliases[key] !== 'string' || !aliases[key].trim() || aliases[key] !== aliases[key].trim() || /[\x00-\x1f\x7f]/.test(aliases[key]))
                fail(aliasField, '别名的键须为合集 Key，值为非空名称。');
        });
        view.querySelector('#txtAnimeApprovedCollectionKeys').value.split(/\r?\n/).forEach(function (line) {
            var key = line.trim();
            if (key && !keyValid(key)) fail('#txtAnimeApprovedCollectionKeys', '批准名单每行只能填写一个合集 Key，格式如 anilist:12345。');
            if (/[*?]/.test(key)) fail('#txtAnimeApprovedCollectionKeys', '批准名单不支持通配符。');
        });
    }

    function getUiConfig(view, forComparison) {
        var flatTags = [];
        view.querySelectorAll('.tag-row').forEach(row => {
            if (!row.querySelector('.txtEntryLabel')) return;
            var entryLabel = row.querySelector('.txtEntryLabel').value;
            var name = row.querySelector('.txtTagName').value || entryLabel;
            var active = row.querySelector('.chkTagActive').checked;

            var blInput = row.querySelector('.txtTagBlacklist');
            var bl = blInput ? blInput.value.split(/[\n\r]+/).map(s => s.trim()).filter(s => s.length > 0) : [];

            var enableTagChk = row.querySelector('.chkEnableTag').checked;
            var enableColl = row.querySelector('.chkEnableCollection').checked;
            var overrideWhenActive = !!(row.querySelector('.chkOverrideWhenActive') || {}).checked;

            var collName = row.querySelector('.txtCollectionName').value;
            var collSortName = row.querySelector('.txtCollectionSortName') ? row.querySelector('.txtCollectionSortName').value.trim() : '';
            var collDescription = row.querySelector('.txtCollectionDescription') ? row.querySelector('.txtCollectionDescription').value : '';
            var collPoster = row.querySelector('.hiddenPosterPath') ? row.querySelector('.hiddenPosterPath').value : '';

            var intervals = [];
            row.querySelectorAll('.date-row').forEach(dr => {
                var type = dr.querySelector('.selDateType').value;
                var s = null, e = null, days = "";

                if (type === 'SpecificDate') {
                    s = dr.querySelector('.txtFullStartDate').value;
                    e = dr.querySelector('.txtFullEndDate').value;
                } else if (type === 'EveryYear') {
                    var sM = dr.querySelector('.selStartMonth').value, sD = dr.querySelector('.selStartDay').value;
                    var eM = dr.querySelector('.selEndMonth').value, eD = dr.querySelector('.selEndDay').value;
                    s = `2000-${sM.padStart(2, '0')}-${sD.padStart(2, '0')}`;
                    e = `2000-${eM.padStart(2, '0')}-${eD.padStart(2, '0')}`;
                } else if (type === 'Weekly') {
                    var activeBtns = Array.from(dr.querySelectorAll('.day-toggle.active')).map(b => b.dataset.day);
                    days = activeBtns.join(',');
                }

                intervals.push({ Type: type, Start: s || null, End: e || null, DayOfWeek: days });
            });

            var currentLastMod = row.dataset.lastModified || new Date().toISOString();
            
            var st = row.querySelector('.selSourceType').value;
            var miFilters = [];
            row.querySelectorAll('.mediainfo-filter-group').forEach(function (group, gi) {
                var operator = group.dataset.op || 'AND';
                var groupOp = gi === 0 ? 'AND' : (group.dataset.groupOp || 'AND');
                var criteria = [];
                group.querySelectorAll('.mi-rule').forEach(function (rule) {
                    var prop = (rule.querySelector('.selMiProperty') || {}).value || '';
                    var selVal = rule.querySelector('.selMiValue');
                    var txtVal = rule.querySelector('.txtMiValue');
                    var selOp  = rule.querySelector('.selMiOp');
                    var txtNum = rule.querySelector('.txtMiNum');
                    var selUser = rule.querySelector('.selMiUser');
                    var selTextOp = rule.querySelector('.selMiTextOp');
                    var val = selVal ? selVal.value : (txtVal ? txtVal.value.replace(/\r?\n/g, '\n').trim() : '');
                    if (prop === 'MediaType' && val === 'Episode') {
                        var incParentChk = rule.querySelector('.chkIncludeParentSeries');
                        if (incParentChk && incParentChk.checked) val = 'EpisodeIncludeSeries';
                    }
                    var op2 = selOp ? selOp.value : '';
                    var textMatchOp = selTextOp ? selTextOp.value : '';
                    var num = txtNum ? txtNum.value.trim() : '';
                    var userId = selUser ? selUser.value : '';
                    var finalOp = op2 || textMatchOp;
                    var finalVal = op2 ? num : val;
                    var notBtn = rule.querySelector('.btnNotToggle');
                    var isNot = notBtn && notBtn.dataset.not === '1';
                    var crit = buildCriterion(prop, finalOp, finalVal, userId);
                    if (crit) criteria.push(isNot ? '!' + crit : crit);
                });
                if (criteria.length > 0) miFilters.push({ Operator: operator, Criteria: criteria, GroupOperator: groupOp });
            });

            var plTab2 = row.querySelector('.playlist-tab');
            var plUserIds2 = plTab2 && plTab2.dataset.plLoaded === '1'
                ? Array.from(plTab2.querySelectorAll('.chkPlaylistUser:checked')).map(function(c) { return c.value; })
                : (function() { try { return JSON.parse(decodeURIComponent((plTab2 && plTab2.dataset.plUserids) || '%5B%5D')); } catch { return []; } })();

            var hseTab = row.querySelector('.homescreen-tab');
            var enableHse = hseTab ? !!(hseTab.querySelector('.chkEnableHomeSection') || {}).checked : false;
            var hseLibraryId = hseTab && hseTab.dataset.hseLoaded === '1'
                ? ((hseTab.querySelector('.selHseLibrary') || {}).value || 'auto')
                : decodeURIComponent((hseTab && hseTab.dataset.hseLibraryid) || 'auto');
            var hseUserIds = hseTab && hseTab.dataset.hseLoaded === '1'
                ? Array.from(hseTab.querySelectorAll('.chkHseUser:checked')).map(function(c) { return c.value; })
                : (function() { try { return JSON.parse(decodeURIComponent((hseTab && hseTab.dataset.hseUserids) || '%5B%5D')); } catch { return []; } })();
            var hseSettings = {};
            if (hseTab && hseTab.dataset.hseLoaded === '1') {
                hseTab.querySelectorAll('[data-field]').forEach(function(el) {
                    var f = el.dataset.field;
                    var v = el.type === 'checkbox' ? String(el.checked) : el.value;
                    hseSettings[f] = v;
                });
                var itemTypesVal = (hseTab.querySelector('.selHseItemTypes') || {}).value || 'Movie,Series';
                hseSettings['ItemTypes'] = JSON.stringify(itemTypesVal.split(','));
                // Compute excluded library IDs from unchecked boxes → stored in _queryExcludeViewIds → Query.ExcludeUserViewIds
                // Also stored in ExcludedFolders → ContentSection.ExcludedFolders (visas i Embys native-meny)
                var _excludedLibIds2 = Array.from(hseTab.querySelectorAll('.chkHseLibrary:not(:checked)')).map(function(c) { return c.value; });
                if (_excludedLibIds2.length > 0) {
                    hseSettings['_queryExcludeViewIds'] = _excludedLibIds2.join(',');
                    hseSettings['ExcludedFolders'] = _excludedLibIds2.join(',');
                } else {
                    delete hseSettings['_queryExcludeViewIds'];
                    delete hseSettings['ExcludedFolders'];
                }
            } else {
                try { hseSettings = JSON.parse(decodeURIComponent((hseTab && hseTab.dataset.hseSettings) || '%7B%7D')); } catch {}
            }
            var hseTracked = (function() { try { return JSON.parse(decodeURIComponent((hseTab && hseTab.dataset.hseTracked) || '%5B%5D')); } catch { return []; } })();

            var baseTag = {
                Name: entryLabel, Tag: name, Active: active, Blacklist: bl, ActiveIntervals: intervals,
                EnableTag: enableTagChk, EnableCollection: enableColl, CollectionName: collName, CollectionSortName: collSortName, CollectionDescription: collDescription, CollectionPosterPath: collPoster, OnlyCollection: false, OverrideWhenActive: overrideWhenActive, LastModified: currentLastMod,
                SourceType: st, MediaInfoFilters: miFilters, MediaInfoConditions: [],
                TagTargetEpisode:        !!(row.querySelector('.chkTagTargetEpisode')  || {}).checked,
                TagTargetSeason:         !!(row.querySelector('.chkTagTargetSeason')   || {}).checked,
                TagTargetSeries:         !!(row.querySelector('.chkTagTargetSeries')   || {}).checked,
                CollectionTargetEpisode: !!(row.querySelector('.chkCollTargetEpisode') || {}).checked,
                CollectionTargetSeason:  !!(row.querySelector('.chkCollTargetSeason')  || {}).checked,
                CollectionTargetSeries:  !!(row.querySelector('.chkCollTargetSeries')  || {}).checked,
                MediaInfoTargetEpisode: false, MediaInfoTargetSeason: false, MediaInfoTargetSeries: false,
                MediaInfoTargetType: '', MediaInfoSeasonMode: false,
                EnableHomeSection: enableHse, HomeSectionLibraryId: hseLibraryId, HomeSectionUserIds: hseUserIds,
                HomeSectionSettings: JSON.stringify(hseSettings),
                HomeSectionTracked: hseTracked,
                EnablePlaylist:   !!(row.querySelector('.chkEnablePlaylist') || {}).checked,
                PlaylistName:     (row.querySelector('.txtPlaylistName') || { value: '' }).value,
                PlaylistUserIds:  plUserIds2,
                PlaylistMappings: (function() { try { return JSON.parse(decodeURIComponent((plTab2 && plTab2.dataset.plMappings) || '%5B%5D')); } catch { return []; } })()
            };

            if (st === 'External') {
                var pushedExternal = false;
                row.querySelectorAll('.url-row').forEach(uRow => {
                    var urlVal = uRow.querySelector('.txtTagUrl').value.trim();
                    var limitVal = parseInt(uRow.querySelector('.txtUrlLimit').value, 10) || 0;
                    if (urlVal) { flatTags.push(Object.assign({}, baseTag, { Url: urlVal, Limit: limitVal, LocalSourceId: "" })); pushedExternal = true; }
                });
                if (forComparison && !pushedExternal) {
                    flatTags.push(Object.assign({}, baseTag, { Url: "", Limit: 0, LocalSourceId: "" }));
                }
            } else if (st === 'LocalCollection' || st === 'LocalPlaylist') {
                var pushedLocal = false;
                row.querySelectorAll('.local-row').forEach(lRow => {
                    var localVal = lRow.querySelector('.selLocalSource').value;
                    var limitVal = parseInt(lRow.querySelector('.txtLocalLimit').value, 10) || 0;
                    if (localVal) { flatTags.push(Object.assign({}, baseTag, { Url: "", Limit: limitVal, LocalSourceId: localVal })); pushedLocal = true; }
                });
                if (forComparison && !pushedLocal) {
                    flatTags.push(Object.assign({}, baseTag, { Url: "", Limit: 0, LocalSourceId: "" }));
                }
            } else if (st === 'AI') {
                var aiLimitVal = parseInt((row.querySelector('.txtAiLimit') || {}).value, 10) || 0;
                flatTags.push(Object.assign({}, baseTag, {
                    Url: "", Limit: aiLimitVal, LocalSourceId: "",
                    AiProvider: (row.querySelector('.selAiProvider') || {}).value || 'OpenAI',
                    AiPrompt: (row.querySelector('.txtAiPrompt') || {}).value || '',
                    AiIncludeRecentlyWatched: !!(row.querySelector('.chkAiRecentlyWatched') || {}).checked,
                    AiRecentlyWatchedUserId: (row.querySelector('.selAiWatchedUser') || {}).value || '',
                    AiRecentlyWatchedCount: parseInt(((row.querySelector('.txtAiWatchedCount') || {}).value || '20'), 10) || 20,
                    AiRefreshIntervalDays: parseInt(((row.querySelector('.txtAiRefreshInterval') || {}).value || '0'), 10) || 0
                }));
            } else {
                var miLimitVal = parseInt((row.querySelector('.txtMediaInfoLimit') || {}).value, 10) || 0;
                flatTags.push(Object.assign({}, baseTag, { Url: "", Limit: miLimitVal, LocalSourceId: "" }));
            }
        });

        var hscEnabled      = view.querySelector('#chkHscEnabled');
        var hscSource       = view.querySelector('#selHscSourceUser');
        var hscLibraryOrder = view.querySelector('#chkHscLibraryOrder');
        var cwbEnabled      = view.querySelector('#chkCwbEnabled');
        var cwbMode         = view.querySelector('#selCwbMode');
        var cwbAllUsers     = view.querySelector('#chkCwbAllUsers');

        return {
            TraktClientId: view.querySelector('#txtTraktClientId').value,
            MdblistApiKey: view.querySelector('#txtMdblistApiKey').value,
            TmdbApiKey: view.querySelector('#txtTmdbApiKey').value,
            OpenAiApiKey: (view.querySelector('#txtOpenAiApiKey') || {}).value || '',
            OpenAiModel: (view.querySelector('#txtOpenAiModel') || {}).value || 'gpt-4o-mini',
            GeminiApiKey: (view.querySelector('#txtGeminiApiKey') || {}).value || '',
            GeminiModel: (view.querySelector('#txtGeminiModel') || {}).value || 'gemini-2.5-flash-lite',
            ClaudeApiKey: (view.querySelector('#txtClaudeApiKey') || {}).value || '',
            ClaudeModel: (view.querySelector('#txtClaudeModel') || {}).value || 'claude-haiku-4-5-20251001',
            OllamaBaseUrl: (view.querySelector('#txtOllamaBaseUrl') || {}).value || 'http://localhost:11434',
            OllamaModel: (view.querySelector('#txtOllamaModel') || {}).value || '',
            CompatibleAiBaseUrl: view.querySelector('#txtCompatibleAiBaseUrl').value.trim(),
            CompatibleAiModel: view.querySelector('#txtCompatibleAiModel').value.trim(),
            CompatibleAiApiKey: view.querySelector('#txtCompatibleAiApiKey').value,
            AiSystemPrompt: (view.querySelector('#txtAiSystemPrompt') || {}).value || '',
            ExtendedConsoleOutput: view.querySelector('#chkExtendedConsoleOutput').checked,
            LogMissingItems: view.querySelector('#chkLogMissingItems').checked,
            DryRunMode: view.querySelector('#chkDryRunMode').checked,
            PreserveTagsOnEmptyResult: view.querySelector('#chkPreserveTagsOnEmptyResult').checked,
            TopListMirrorCollections: view.querySelector('#chkTopListMirrorCollections').checked,
            AnimeEnabled: view.querySelector('#chkAnimeEnabled').checked,
            AnimeDryRun: view.querySelector('#chkAnimeDryRun').checked,
            AnimeIncludeSpinOffs: view.querySelector('#chkAnimeIncludeSpinOffs').checked,
            AnimeSkipWriteWhenReminders: !!(view.querySelector('#chkAnimeSkipWriteWhenReminders') || {}).checked,
            AnimeAiReviewOtherEdges: view.querySelector('#chkAnimeAiOther').checked,
            AnimeAiNamingEnabled: view.querySelector('#chkAnimeAiNaming').checked,
            AnimeAiCollectionReviewEnabled: view.querySelector('#chkAnimeAiCollectionReview').checked,
            AnimeAiMaxCallsPerRun: aiBudgetValue(view, '#txtAnimeAiMaxCalls', 15),
            AnimeAiMaxTokensPerCall: aiBudgetValue(view, '#txtAnimeAiMaxTokensPerCall', 800),
            AnimeAiMaxTokensPerRun: aiBudgetValue(view, '#txtAnimeAiMaxTokensPerRun', 4000),
            AnimeAiProvider: selectedAnimeAiProvider(view),
            AnimeCollectionPrefix: view.querySelector('#txtAnimePrefix').value || '动漫 · ',
            AnimeMappingRefreshDays: 7,
            AnimeMappingUrl: (view.querySelector('#txtAnimeMappingUrl') || {}).value || '',
            AnimeMaxRequestsPerRun: Math.min(600, Math.max(10, parseInt(view.querySelector('#txtAnimeApiBudget').value, 10) || 300)),
            AnimeCollectionRulesJson: view.querySelector('#txtAnimeCollectionRulesJson').value,
            AnimeApprovedCollectionKeys: view.querySelector('#txtAnimeApprovedCollectionKeys').value,
            AnimeCollectionAliasesJson: view.querySelector('#txtAnimeCollectionAliasesJson').value,
            Tags: flatTags,
            SavedFilters: savedFilters,
            HomeSyncEnabled: hscEnabled ? hscEnabled.checked : (lastHscConfig.HomeSyncEnabled || false),
            HomeSyncLibraryOrder: hscLibraryOrder ? hscLibraryOrder.checked : (lastHscConfig.HomeSyncLibraryOrder || false),
            HomeSyncSourceUserId: hscSource ? (hscSource.value || '') : (lastHscConfig.HomeSyncSourceUserId || ''),
            HomeSyncTargetUserIds: hscEnabled
                ? Array.from(view.querySelectorAll('.hsc-target-chk:checked')).map(function(c) { return c.value; })
                : (lastHscConfig.HomeSyncTargetUserIds || []),
            ContinueWatchingBumpEnabled: cwbEnabled ? cwbEnabled.checked : (lastHscConfig.ContinueWatchingBumpEnabled || false),
            ContinueWatchingBumpMode: cwbMode ? (cwbMode.value || 'AllEpisodes') : (lastHscConfig.ContinueWatchingBumpMode || 'AllEpisodes'),
            ContinueWatchingBumpAllUsers: cwbAllUsers ? cwbAllUsers.checked : (lastHscConfig.ContinueWatchingBumpAllUsers || false),
            ContinueWatchingBumpUserIds: cwbEnabled
                ? Array.from(view.querySelectorAll('.cwb-user-chk:checked')).map(function(c) { return c.value; })
                : (lastHscConfig.ContinueWatchingBumpUserIds || [])
        };
    }

    function checkFormState() {
        var view = document.querySelector('#HomeScreenCompanionConfigPage');
        if (!view || !originalConfigState) return;
        
        var isDirty = false;
        try {
            var current = JSON.stringify(getUiConfig(view, true));
            isDirty = current !== originalConfigState;
        } catch (e) {
            isDirty = true;
        }

        var btnApplyManage = view.querySelector('#btnApplyManage');
        if (btnApplyManage && !btnApplyManage.disabled) isDirty = true;

        var tcContainer = view.querySelector('#tcManageContainer');
        if (tcContainer && tcContainer._tcHasPending) isDirty = true;

        var tlContainer = view.querySelector('#tlContainer');
        if (tlContainer && tlContainer.querySelector('.tag-body[data-dirty="1"]')) isDirty = true;

        var btnSave = view.querySelector('.btn-save');
        if (btnSave) {
            var isSyncRunning = (btnSave.querySelector('span').textContent || "").includes("progress");
            if (isSyncRunning) {
                btnSave.disabled = true;
                btnSave.style.opacity = "0.5";
            } else {
                btnSave.disabled = !isDirty;
                btnSave.style.opacity = isDirty ? "1" : "0.5";
            }
        }
    }

    function updateDryRunWarning() {
        var view = document.querySelector('#HomeScreenCompanionConfigPage');
        if (!view || !originalConfigState) return;
        var warn = view.querySelector('.dry-run-warning');
        if (warn) {
            try {
                var savedConfig = JSON.parse(originalConfigState);
                warn.style.display = savedConfig.DryRunMode ? 'flex' : 'none';
            } catch (e) {
                warn.style.display = 'none';
            }
        }
        updateAnimeGlobalDryHint(view);
    }

    function applyFilters(view) {
        var container = view.querySelector('#tagListContainer');
        var rows = container.querySelectorAll('.tag-row');

        var searchTerm = (view.querySelector('#txtSearchTags').value || "").toLowerCase();

        var fTag        = view.querySelector('#chkFilterTag')?.checked;
        var fColl       = view.querySelector('#chkFilterCollection')?.checked;
        var fSched      = view.querySelector('#chkFilterSchedule')?.checked;
        var fHome       = view.querySelector('#chkFilterHomeScreen')?.checked;
        var fSrcExt     = view.querySelector('#chkFilterSrcExternal')?.checked;
        var fSrcMI      = view.querySelector('#chkFilterSrcMediaInfo')?.checked;
        var fSrcColl    = view.querySelector('#chkFilterSrcCollection')?.checked;
        var fSrcPlay    = view.querySelector('#chkFilterSrcPlaylist')?.checked;
        var fSrcAI      = view.querySelector('#chkFilterSrcAI')?.checked;
        var fActive     = view.querySelector('#chkFilterActive')?.checked;
        var fInactive   = view.querySelector('#chkFilterInactive')?.checked;

        var anyFeature  = fTag || fColl || fSched || fHome;
        var anySrc      = fSrcExt || fSrcMI || fSrcColl || fSrcPlay || fSrcAI;
        var anyStatus   = fActive || fInactive;

        // Update button appearance
        var btn = view.querySelector('#btnFilterDropdown');
        var lbl = view.querySelector('#filterDropdownLabel');
        if (btn && lbl) {
            var activeCount = [fTag, fColl, fSched, fHome, fSrcExt, fSrcMI, fSrcColl, fSrcPlay, fSrcAI, fActive, fInactive].filter(Boolean).length;
            lbl.textContent = activeCount > 0 ? '筛选 (' + activeCount + ')' : '筛选';
            btn.classList.toggle('active', activeCount > 0);
        }

        rows.forEach(row => {
            var tagName  = (row.querySelector('.txtTagName').value || "").toLowerCase();
            var entryLbl = (row.querySelector('.txtEntryLabel').value || "").toLowerCase();
            var matchesSearch = !searchTerm || tagName.includes(searchTerm) || entryLbl.includes(searchTerm);

            var matchesFeature = true;
            if (anyFeature) {
                var hasTag   = row.querySelector('.chkEnableTag')?.checked;
                var hasColl  = row.querySelector('.chkEnableCollection')?.checked;
                var hasSched = row.querySelectorAll('.date-row').length > 0;
                var hasHome  = row.querySelector('.chkEnableHomeSection')?.checked;
                matchesFeature = (fTag && hasTag) || (fColl && hasColl) || (fSched && hasSched) || (fHome && hasHome);
            }

            var matchesSrc = true;
            if (anySrc) {
                var src = row.querySelector('.selSourceType')?.value || '';
                matchesSrc = (fSrcExt && src === 'External') || (fSrcMI && src === 'MediaInfo') ||
                             (fSrcColl && src === 'LocalCollection') || (fSrcPlay && src === 'LocalPlaylist') ||
                             (fSrcAI && src === 'AI');
            }

            var matchesStatus = true;
            if (anyStatus) {
                var isActive = row.querySelector('.chkTagActive')?.checked;
                matchesStatus = (fActive && isActive) || (fInactive && !isActive);
            }

            row.style.display = (matchesSearch && matchesFeature && matchesSrc && matchesStatus) ? 'block' : 'none';
        });
    }

    function checkForUpdates(view) {
        window.ApiClient.getJSON(window.ApiClient.getUrl("HomeScreenCompanionAnime/Version"))
            .then(function (result) {
                var footer = document.getElementById('footerVersionText');
                if (footer) footer.textContent = '动漫版 v' + (result.Version || '?');
                var upd = document.getElementById('footerUpdateInfo');
                if (upd) upd.textContent = '';
            }).catch(function () {});
        // Fork builds are not automatically upgraded from upstream releases.
    }

    window._testUpdateBanner = function (mode) {
        var fakeTag = '99.99.99';
        var fakeUrl = 'https://github.com/soderlund91/HomeScreenCompanion/releases';
        var footerUpdate = document.getElementById('footerUpdateInfo');
        if (!footerUpdate) { console.warn('_testUpdateBanner: 未找到 #footerUpdateInfo'); return; }
        var footerUpdateSep = document.getElementById('footerUpdateSep');
        if (mode === 'banner' || mode === 'discreet') {
            footerUpdate.innerHTML = '<a href="' + fakeUrl + '"'
                + ' target="_blank" class="footer-update-link">有可用更新：v' + fakeTag + '</a>';
            if (footerUpdateSep) footerUpdateSep.style.display = '';
        } else if (mode === 'reset') {
            footerUpdate.innerHTML = '';
            if (footerUpdateSep) footerUpdateSep.style.display = 'none';
        }
    };

    function groupConfigTags(tags) {
        var grouped = {};
        (tags || []).forEach(t => {
            var key = t.Name ? t.Name + '\x1F' + t.Tag : t.Tag;
            if (!grouped[key]) {
                grouped[key] = {
                    Tag: t.Tag, Name: t.Name || '', Urls: [], LocalSources: [], Active: t.Active !== false, Blacklist: t.Blacklist, ActiveIntervals: t.ActiveIntervals,
                    EnableTag: t.EnableTag !== false, EnableCollection: t.EnableCollection, CollectionName: t.CollectionName, CollectionSortName: t.CollectionSortName || '', CollectionDescription: t.CollectionDescription || '', CollectionPosterPath: t.CollectionPosterPath || '', OnlyCollection: t.OnlyCollection, OverrideWhenActive: t.OverrideWhenActive || false, LastModified: t.LastModified,
                    SourceType: t.SourceType || "External", MediaInfoConditions: t.MediaInfoConditions || [], MediaInfoFilters: t.MediaInfoFilters || [],
                    Limit: t.Limit || 0,
                    EnableHomeSection: t.EnableHomeSection || false, HomeSectionLibraryId: t.HomeSectionLibraryId || 'auto',
                    HomeSectionUserIds: t.HomeSectionUserIds || [], HomeSectionSettings: t.HomeSectionSettings || '{}',
                    HomeSectionTracked: t.HomeSectionTracked || [],
                    AiProvider: t.AiProvider || 'OpenAI',
                    AiPrompt: t.AiPrompt || '',
                    AiIncludeRecentlyWatched: t.AiIncludeRecentlyWatched || false,
                    AiRecentlyWatchedUserId: t.AiRecentlyWatchedUserId || '',
                    AiRecentlyWatchedCount: t.AiRecentlyWatchedCount || 20,
                    TagTargetEpisode: t.TagTargetEpisode || false,
                    TagTargetSeason:  t.TagTargetSeason  || false,
                    TagTargetSeries:  t.TagTargetSeries  || false,
                    CollectionTargetEpisode: t.CollectionTargetEpisode || false,
                    CollectionTargetSeason:  t.CollectionTargetSeason  || false,
                    CollectionTargetSeries:  t.CollectionTargetSeries  || false,
                    EnablePlaylist:   t.EnablePlaylist   || false,
                    PlaylistName:     t.PlaylistName     || '',
                    PlaylistUserIds:  t.PlaylistUserIds  || [],
                    PlaylistMappings: t.PlaylistMappings || [],
                };
            }
            if (t.SourceType === 'External' && t.Url) grouped[key].Urls.push({ url: t.Url, limit: t.Limit });
            if ((t.SourceType === 'LocalCollection' || t.SourceType === 'LocalPlaylist') && t.LocalSourceId) grouped[key].LocalSources.push({ id: t.LocalSourceId, limit: t.Limit });
            if (t.SourceType === 'MediaInfo') grouped[key].Limit = t.Limit;
            if (t.SourceType === 'AI') grouped[key].Limit = t.Limit;
        });
        return grouped;
    }


    function renderHscTab(container, config, users) {
        var sourceOptions = users.map(function (u) {
            return '<option value="' + u.Id + '"' + (config.HomeSyncSourceUserId === u.Id ? ' selected' : '') + '>' + u.Name + '</option>';
        }).join('');

        var targetRows = users.map(function (u) {
            var checked = (config.HomeSyncTargetUserIds || []).indexOf(u.Id) >= 0 ? ' checked' : '';
            return '<div class="hsc-user-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;width:100%;">' +
                '<input is="emby-checkbox" type="checkbox" class="hsc-target-chk" value="' + u.Id + '"' + checked + ' />' +
                '<span>' + u.Name + '</span>' +
                '</label></div>';
        }).join('');

        var enabled      = config.HomeSyncEnabled ? ' checked' : '';
        var libOrderChk  = config.HomeSyncLibraryOrder ? ' checked' : '';

        var syncDisplay = config.HomeSyncEnabled ? '' : 'none';

        container.innerHTML = [
            '<div class="hsc-card">',
            '<h3 class="hsc-section-title">配置</h3>',
            '<div class="checkboxContainer checkboxContainer-withDescription">',
            '<label><input is="emby-checkbox" type="checkbox" id="chkHscEnabled"' + enabled + ' /><span>启用主屏幕同步</span></label>',
            '<div class="fieldDescription">启用后，插件会同步来源用户的所有主屏幕栏目，并应用到所选用户。禁用后，即使手动触发也会跳过任务。</div>',
            '</div>',
            '<div id="hscSyncConfig" style="display:' + syncDisplay + '">',
            '<div class="checkboxContainer checkboxContainer-withDescription" style="margin-top:8px;">',
            '<label><input is="emby-checkbox" type="checkbox" id="chkHscLibraryOrder"' + libOrderChk + ' /><span>同时复制媒体库顺序</span></label>',
            '<div class="fieldDescription">同时同步导航侧栏中的媒体库顺序。</div>',
            '</div>',
            '<div class="inputContainer" style="margin-top:16px;">',
            '<select is="emby-select" id="selHscSourceUser" label="来源用户">',
            '<option value="">— 选择来源用户 —</option>',
            sourceOptions,
            '</select>',
            '<div class="fieldDescription">将此用户的主屏幕栏目复制到下方所选的所有用户。</div>',
            '</div>',
            '</div>',
            '</div>',

            '<div class="hsc-card" id="hscSyncToCard" style="display:' + syncDisplay + '">',
            '<h3 class="hsc-section-title">同步到</h3>',
            '<p class="textMuted" style="font-size:0.88em;margin-bottom:12px;">每次同步时，以下用户都会应用来源用户的主屏幕布局。</p>',
            '<div class="hsc-user-list" id="hscTargetList">',
            targetRows ? buildSelectAllRowHtml('hsc-user-row') + targetRows : '<p class="textMuted" style="font-size:0.85em;">未找到用户。</p>',
            '</div>',
            '</div>',

        ].join('');

        container.dataset.loaded = '1';
    }

    function enforceHscSourceTargetConflict(container) {
        var sourceId = (container.querySelector('#selHscSourceUser') || {}).value || '';
        container.querySelectorAll('.hsc-target-chk').forEach(function (chk) {
            var isConflict = sourceId && chk.value === sourceId;
            if (isConflict) {
                chk.checked = false;
                chk.disabled = true;
                chk.closest('.hsc-user-row').title = '无法将用户同步到自身';
                chk.closest('.hsc-user-row').style.opacity = '0.45';
            } else {
                chk.disabled = false;
                chk.closest('.hsc-user-row').title = '';
                chk.closest('.hsc-user-row').style.opacity = '';
            }
        });
    }

    function loadHscUsers(view) {
        var container = view.querySelector('#hscContainer');
        if (!container) return;

        window.ApiClient.getJSON(window.ApiClient.getUrl('Users', { IsDisabled: false }))
            .then(function (users) {
                renderHscTab(container, lastHscConfig, users || []);

                enforceHscSourceTargetConflict(container);
                var syncTargetSelectAll = wireSelectAll(container.querySelector('#hscTargetList'), '.hsc-target-chk');

                var enableChk = container.querySelector('#chkHscEnabled');
                if (enableChk) {
                    enableChk.addEventListener('change', function () {
                        var show = this.checked;
                        var syncConfig = container.querySelector('#hscSyncConfig');
                        var syncToCard = container.querySelector('#hscSyncToCard');
                        if (syncConfig) syncConfig.style.display = show ? '' : 'none';
                        if (syncToCard) syncToCard.style.display = show ? '' : 'none';
                        setTimeout(checkFormState, 0);
                    });
                }

                var sourceSelect = container.querySelector('#selHscSourceUser');
                if (sourceSelect) {
                    sourceSelect.addEventListener('change', function () {
                        enforceHscSourceTargetConflict(container);
                        syncTargetSelectAll();
                        setTimeout(checkFormState, 0);
                    });
                }

                container.querySelectorAll('.hsc-target-chk').forEach(function (chk) {
                    chk.addEventListener('change', function () {
                        enforceHscSourceTargetConflict(container);
                        setTimeout(checkFormState, 0);
                    });
                });

                container.querySelectorAll('input:not(.hsc-target-chk), select:not(#selHscSourceUser)').forEach(function (el) {
                    el.addEventListener('change', function () { setTimeout(checkFormState, 0); });
                    el.addEventListener('input',  function () { setTimeout(checkFormState, 0); });
                });

            })
            .catch(function () {
                container.innerHTML = '<p class="textMuted" style="padding:20px;">加载用户失败。请检查服务器连接。</p>';
            });
    }


    // ── Home Screen Tweaks ───────────────────────────────────────────────────
    // Expandable panels in the same style as the Settings tab (.settings-panel —
    // toggled by the delegated click handler, so no per-panel wiring is needed).

    function renderHstTab(container, config, users) {
        var cwbUserIds   = config.ContinueWatchingBumpUserIds || [];
        var cwbUserRows  = users.map(function (u) {
            var checked = cwbUserIds.indexOf(u.Id) >= 0 ? ' checked' : '';
            return '<div class="hsc-user-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;width:100%;">' +
                '<input is="emby-checkbox" type="checkbox" class="cwb-user-chk" value="' + u.Id + '"' + checked + ' />' +
                '<span>' + u.Name + '</span>' +
                '</label></div>';
        }).join('');
        var cwbEnabled   = config.ContinueWatchingBumpEnabled ? ' checked' : '';
        var cwbAllUsers  = config.ContinueWatchingBumpAllUsers ? ' checked' : '';
        var cwbMode      = config.ContinueWatchingBumpMode || 'AllEpisodes';
        var cwbDisplay   = config.ContinueWatchingBumpEnabled ? '' : 'none';
        var cwbUsersDisp = config.ContinueWatchingBumpAllUsers ? 'none' : '';

        container.innerHTML = [
            '<div class="advanced-section settings-panel" style="margin-bottom: 15px;">',
            '<div class="advanced-header settings-panel-toggle">',
            '<span style="font-size: 1.05em; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #52B54B;">继续观看</span>',
            '<i class="md-icon settings-panel-chevron" style="margin-left: auto; transition: transform 0.2s;">expand_more</i>',
            '</div>',
            '<div class="advanced-body settings-panel-body" style="display:none; padding-top: 4px;">',

            '<div style="display:flex; align-items:flex-start; gap:8px; margin:0 0 12px; padding:8px 12px; border:1px solid rgba(255,152,0,0.5); border-radius:4px; background:rgba(255,152,0,0.08); font-size:0.85em; line-height:1.45;">',
            '<i class="md-icon" style="color:#FF9800; font-size:1.2em;">warning</i>',
            '<div><strong style="color:#FF9800;">实验性功能。</strong>可安全使用，不会更改已观看状态，只会修改某一集的“上次播放”日期。此功能已经过测试，但仍需更多实际使用验证才能视为完全稳定。</div>',
            '</div>',

            '<p style="font-size:0.9em; line-height:1.5; margin:0 0 24px;">',
            'Emby 按上次观看剧集的时间对“继续观看”排序，因此一年前看完的剧集即使有新一季上线，也仍会排在后面。 ',
            '此功能会在新一集添加后立即将这类剧集移到最前面。',
            '</p>',

            '<div class="checkboxContainer checkboxContainer-withDescription">',
            '<label><input is="emby-checkbox" type="checkbox" id="chkCwbEnabled"' + cwbEnabled + ' /><span>将有新集的剧集移到“继续观看”最前面</span></label>',
            '<div class="fieldDescription">仅适用于已看完所有现有集数的剧集。每个新集只触发一次前移：若该新集一直未观看，后续新集不会再次触发前移。媒体库扫描后约 2 分钟运行，计划任务<em>继续观看前移</em>也会补充执行。</div>',
            '</div>',
            '<div id="cwbConfig" style="display:' + cwbDisplay + '">',
            '<div class="inputContainer" style="margin-top:16px;">',
            '<select is="emby-select" id="selCwbMode" label="前移时机">',
            '<option value="AllEpisodes"' + (cwbMode === 'AllEpisodes' ? ' selected' : '') + '>添加任意新集时</option>',
            '<option value="NewSeasonsOnly"' + (cwbMode === 'NewSeasonsOnly' ? ' selected' : '') + '>添加新一季时</option>',
            '</select>',
            '<div class="fieldDescription">“添加新一季时”仅在下一集是新一季的开头时触发前移（例如看完第 1 季后的 S02E01）。</div>',
            '</div>',
            '<div class="checkboxContainer checkboxContainer-withDescription" style="margin-top:8px;">',
            '<label><input is="emby-checkbox" type="checkbox" id="chkCwbAllUsers"' + cwbAllUsers + ' /><span>所有用户</span></label>',
            '<div class="fieldDescription">适用于所有用户，包括以后添加的用户。</div>',
            '</div>',
            '<div id="cwbUserListWrap" style="display:' + cwbUsersDisp + '">',
            '<p class="textMuted" style="font-size:0.88em;margin:12px 0;">为以下用户将剧集前移至“继续观看”：</p>',
            '<div class="hsc-user-list" id="cwbUserList">',
            cwbUserRows ? buildSelectAllRowHtml('hsc-user-row') + cwbUserRows : '<p class="textMuted" style="font-size:0.85em;">未找到用户。</p>',
            '</div>',
            '</div>',
            '</div>',

            '<div style="margin-top:16px; padding:10px 14px; border:1px solid rgba(128,128,128,0.2); border-radius:4px;">',
            '<div style="font-size:0.75em; font-weight:700; text-transform:uppercase; letter-spacing:1.4px; opacity:0.6; margin-bottom:6px;">注意事项</div>',
            '<ul style="font-size:0.85em; line-height:1.5; margin:0; padding-left:18px; opacity:0.85;">',
            '<li>您最后看过的单集的<strong>“上次播放”日期</strong>将设为当前时间。已观看状态和播放次数保持不变，但任何显示上次播放时间或据此排序的功能（如观看历史、使用<em>上次播放</em>的标签规则）都会使用新日期。</li>',
            '<li><strong>替换未观看的单集</strong>（如升级画质）会使其显示为新添加，并可能再次将该剧集前移。</li>',
            '<li>如果您<strong>跳过了某些单集</strong>，则不会前移——截至最后看过的单集，之前的每一集都必须已播放。特别篇（第 0 季）不计入。</li>',
            '<li>您已从“继续观看”中<strong>隐藏</strong>的剧集会保持隐藏。</li>',
            '</ul>',
            '</div>',

            '</div>',
            '</div>'
        ].join('');

        container.dataset.loaded = '1';
    }

    function loadHstTab(view) {
        var container = view.querySelector('#hstContainer');
        if (!container) return;

        window.ApiClient.getJSON(window.ApiClient.getUrl('Users', { IsDisabled: false }))
            .then(function (users) {
                renderHstTab(container, lastHscConfig, users || []);
                wireSelectAll(container.querySelector('#cwbUserList'), '.cwb-user-chk');

                var cwbEnableChk = container.querySelector('#chkCwbEnabled');
                if (cwbEnableChk) {
                    cwbEnableChk.addEventListener('change', function () {
                        var cwbConfig = container.querySelector('#cwbConfig');
                        if (cwbConfig) cwbConfig.style.display = this.checked ? '' : 'none';
                    });
                }
                var cwbAllUsersChk = container.querySelector('#chkCwbAllUsers');
                if (cwbAllUsersChk) {
                    cwbAllUsersChk.addEventListener('change', function () {
                        var wrap = container.querySelector('#cwbUserListWrap');
                        if (wrap) wrap.style.display = this.checked ? 'none' : '';
                    });
                }

                container.querySelectorAll('input, select').forEach(function (el) {
                    el.addEventListener('change', function () { setTimeout(checkFormState, 0); });
                    el.addEventListener('input',  function () { setTimeout(checkFormState, 0); });
                });
            })
            .catch(function () {
                container.innerHTML = '<p class="textMuted" style="padding:20px;">加载用户失败。请检查服务器连接。</p>';
            });
    }

    function getManDragAfterElement(container, y) {
        var els = [...container.querySelectorAll('.man-section-row:not(.man-dragging)')];
        return els.reduce(function (closest, child) {
            var box = child.getBoundingClientRect();
            var offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function loadTagManageTab(view) {
        var container = view.querySelector('#tcManageContainer');
        if (!container) return;

        container.innerHTML = '<div style="padding:20px;color:var(--theme-text-secondary);display:flex;align-items:center;gap:10px;">加载中 <span class="tc-dot-loader"><span></span><span></span><span></span></span></div>';

        var token = window.ApiClient.accessToken();
        var pendingTagDeletes = {};       // tagName.toLowerCase() -> { name, itemCount }
        var pendingCollDeletes = {};      // collectionId -> { id, name, itemCount }

        Promise.all([
            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Manage/Tags'), { headers: { 'X-MediaBrowser-Token': token } }).then(function (r) { return r.json(); }),
            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Manage/Collections'), { headers: { 'X-MediaBrowser-Token': token } }).then(function (r) { return r.json(); }),
            window.ApiClient.getPluginConfiguration(pluginId).catch(function () { return { Tags: [] }; })
        ]).then(function (results) {
            var tagsData = results[0];
            var collectionsData = results[1];
            var pluginConfig = results[2];

            // Build maps: which tags/collections are managed by a plugin group
            // Each logical group may appear multiple times in cfg.Tags (one entry per URL/source).
            // Deduplicate by Tag value so we get one entry per logical group.
            var managedTagMap = {};   // tagName.toLowerCase() -> [{ displayName, groupIndex, groupActive }, ...]
            var managedCollMap = {};  // collectionName.toLowerCase() -> [{ displayName, groupIndex, groupActive }, ...]
            var seenGroupByTag = {};  // tKey -> Set of first-seen indices (to deduplicate multi-URL groups)
            (pluginConfig.Tags || []).forEach(function (t, idx) {
                if (!t.Tag) return;
                var tName = t.Tag.trim();
                var tKey = tName.toLowerCase();
                // Skip if we already recorded an entry for this exact tag from a previous URL-row of the same group
                if (seenGroupByTag[tKey]) return;
                seenGroupByTag[tKey] = true;
                var groupLabel = (t.Name && t.Name.trim() && t.Name.trim().toLowerCase() !== tKey) ? t.Name.trim() : tName;
                var entry = { displayName: groupLabel, groupIndex: idx, groupActive: !!t.Active };
                if (!managedTagMap[tKey]) managedTagMap[tKey] = [];
                managedTagMap[tKey].push(entry);
                if (t.EnableCollection) {
                    var cName = (t.CollectionName && t.CollectionName.trim()) ? t.CollectionName.trim() : tName;
                    var cKey = cName.toLowerCase();
                    if (!managedCollMap[cKey]) managedCollMap[cKey] = [];
                    managedCollMap[cKey].push(entry);
                }
            });

            function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
            function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

            var btnStyle = 'cursor:pointer;border:none;border-radius:3px;padding:4px 12px;font-size:0.82em;font-weight:500;';

            function renderSection(title, items, isTagSection, headerExtra) {
                var sectionId = isTagSection ? 'tcTagSection' : 'tcCollSection';
                var rows = items.length === 0
                    ? '<div style="color:var(--theme-text-secondary);padding:8px 0;">未找到项目。</div>'
                    : items.map(function (item) {
                        var id = item.Id || '';
                        var name = item.Name || '';
                        var count = item.ItemCount != null ? item.ItemCount : 0;
                        var managed = isTagSection ? managedTagMap[name.toLowerCase()] : managedCollMap[name.toLowerCase()];
                        var badge = managed && managed.length > 0
                            ? '<span style="font-size:0.75em;background:#52B54B22;color:#52B54B;border:1px solid #52B54B55;border-radius:4px;padding:1px 6px;margin-left:8px;white-space:nowrap;">由 HSC 插件管理</span>'
                            : '';
                        var typesVal = isTagSection ? (item.ItemTypes || []).map(function (t) { return t.toLowerCase(); }).join(',') : '';
                        return '<tr class="tc-manage-row" data-rowname="' + escAttr(name.toLowerCase()) + '" data-managed="' + (managed && managed.length > 0 ? '1' : '0') + '" data-count="' + count + '" data-types="' + escAttr(typesVal) + '">' +
                            '<td style="padding:9px 4px;border-bottom:1px solid var(--line-color);width:100%;max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                            (id
                                ? '<a class="tc-item-name tc-nav-link" href="javascript:void(0)" data-navid="' + escAttr(id) + '" style="color:inherit;text-decoration:none;cursor:pointer;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(name) + '</a>'
                                : '<span class="tc-item-name">' + escHtml(name) + '</span>') +
                            badge +
                            '</td>' +
                            '<td style="padding:9px 4px 9px 16px;border-bottom:1px solid var(--line-color);white-space:nowrap;color:var(--theme-text-secondary);font-size:0.88em;">' + count + ' 项</td>' +
                            '<td style="padding:9px 4px 9px 8px;border-bottom:1px solid var(--line-color);white-space:nowrap;">' +
                            '<button type="button" class="btnTcMark" style="' + btnStyle + 'background:#cc3333;color:#fff;" data-id="' + escAttr(id) + '" data-name="' + escAttr(name) + '" data-count="' + count + '" data-type="' + (isTagSection ? 'tag' : 'coll') + '">移除</button>' +
                            '</td>' +
                            '</tr>';
                    }).join('');

                return '<div id="' + sectionId + '" style="flex:1 1 300px;min-width:0;">' +
                    '<div style="display:flex;align-items:center;gap:30px;margin-bottom:12px;">' + 
                    '<h3 style="margin:0;font-size:1em;text-transform:uppercase;letter-spacing:1px;color:#52B54B;">' + escHtml(title) + '</h3>' +
                    (headerExtra || '') +
                    '<button type="button" class="btnTcRefresh" style="' + btnStyle + 'background:transparent;color:var(--theme-text-secondary);border:1px solid var(--line-color);margin-left:auto;"><i class="md-icon" style="font-size:1em;vertical-align:middle;">refresh</i></button>' +
                    '</div>' +
                    '<table class="tc-manage-list" style="width:100%;border-collapse:collapse;"><tbody>' + rows + '</tbody></table>' +
                    '</div>';
            }

            var searchInputStyle = 'background:rgba(128,128,128,0.08);border:1px solid var(--line-color);border-radius:4px;padding:5px 10px;font-size:0.9em;color:inherit;width:400px;max-width:100%;';

            var tcTypeGroups = [
                { label: '电影',       types: ['movie'] },
                { label: '剧集',       types: ['series'] },
                { label: '单集',     types: ['episode'] },
                { label: '季',      types: ['season'] },
                { label: '音乐',        types: ['audio', 'musicvideo', 'musicalbum', 'musicartist'] },
                { label: '图书',        types: ['book'] },
                { label: '游戏',        types: ['game'] },
                { label: '预告片',     types: ['trailer'] },
                { label: '主题曲',  types: ['themesong'] },
                { label: '主题视频', types: ['themevideo', 'video'] },
                { label: '附加内容',       types: ['behindthescenes', 'deletedscene', 'interview', 'scene', 'clip', 'featurette', 'short'] },
                { label: '人物',       types: ['person'] },
                { label: '合集',  types: ['boxset'] },
                { label: '照片',       types: ['photo', 'photoalbum'] },
                { label: '播放列表',    types: ['playlist'] },
                { label: '录制内容',   types: ['recording'] },
                { label: '制作公司',      types: ['studio'] }
            ];

            var tcExtraTypes = ['themesong', 'themevideo', 'trailer', 'behindthescenes', 'deletedscene', 'interview', 'scene', 'clip', 'featurette', 'short'];

            var presentGroups = tcTypeGroups.filter(function (g) {
                return (tagsData.Tags || []).some(function (tag) {
                    return (tag.ItemTypes || []).some(function (t) {
                        return g.types.indexOf(t.toLowerCase()) !== -1;
                    });
                });
            });

            var typeFilterDropdownHtml = presentGroups.length > 0
                ? '<div class="filter-dropdown-wrapper" id="tcTypeFilterWrap">' +
                  '<div class="filter-dropdown-btn" id="tcTypeFilterBtn">' +
                  '<i class="md-icon" style="font-size:1.1em;">filter_list</i>' +
                  '<span id="tcTypeFilterLabel">筛选标签</span>' +
                  '<i class="md-icon" style="font-size:0.9em;opacity:0.6;" id="tcTypeFilterCaret">expand_more</i>' +
                  '</div>' +
                  '<div class="filter-dropdown-panel" id="tcTypeFilterDropdown">' +
                  '<div class="filter-dropdown-label">媒体类型</div>' +
                  presentGroups.map(function (g) {
                      return '<label class="filter-chk-row"><input type="checkbox" class="cbTypeFilter" data-group="' + escAttr(g.label) + '"> <span>' + escHtml(g.label) + '</span></label>';
                  }).join('') +
                  '</div></div>'
                : '';

            var extrasCheckboxHtml =
                '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9em;white-space:nowrap;opacity:0.8;">' +
                '<input type="checkbox" id="cbIncludeExtras" style="cursor:pointer;margin:0;">' +
                '<span>包含附加内容</span>' +
                '</label>';

            container.innerHTML =
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">' +
                '<input type="text" id="tcSearch" placeholder="搜索…" style="' + searchInputStyle + '" />' +
                '<select is="emby-select" id="tcSort" style="color:inherit;background:rgba(128,128,128,0.08);border:1px solid var(--line-color);padding:5px;border-radius:4px;font-size:0.9em;cursor:pointer;">' +
                '<option value="name-asc">名称 A–Z</option>' +
                '<option value="name-desc">名称 Z–A</option>' +
                '<option value="count-desc">项目最多</option>' +
                '<option value="count-asc">项目最少</option>' +
                '<option value="managed">受管理的优先</option>' +
                '</select>' +
                '</div>' +
                '<div id="tcSectionsWrap" style="display:flex;gap:40px;align-items:flex-start;">' +
                renderSection('标签', tagsData.Tags || [], true, typeFilterDropdownHtml + extrasCheckboxHtml) +
                renderSection('合集', collectionsData.Collections || [], false) +
                '</div>';

            container.dataset.loaded = '1';

            function getSelectedTypeGroups() {
                return Array.from(container.querySelectorAll('.cbTypeFilter:checked')).map(function (cb) { return cb.dataset.group; });
            }

            function rowMatchesTypeFilter(row, selectedGroups) {
                if (selectedGroups.length === 0) return true;
                var rowTypes = (row.dataset.types || '').split(',').filter(Boolean);
                return selectedGroups.some(function (groupLabel) {
                    var group = tcTypeGroups.find(function (g) { return g.label === groupLabel; });
                    if (!group) return false;
                    return rowTypes.some(function (t) { return group.types.indexOf(t) !== -1; });
                });
            }

            function updateTypeFilterBtn() {
                var btn = container.querySelector('#tcTypeFilterBtn');
                var lbl = container.querySelector('#tcTypeFilterLabel');
                if (!btn || !lbl) return;
                var selected = getSelectedTypeGroups();
                lbl.textContent = selected.length === 0 ? '筛选标签' : selected.length + ' 种类型' + (selected.length > 1 ? '' : '');
                if (selected.length > 0) btn.classList.add('active');
                else btn.classList.remove('active');
            }

            function applySearchSort() {
                var query = (container.querySelector('#tcSearch').value || '').toLowerCase();
                var sort = container.querySelector('#tcSort').value;
                var selectedGroups = getSelectedTypeGroups();
                var includeExtras = !!(container.querySelector('#cbIncludeExtras') || {}).checked;

                ['tcTagSection', 'tcCollSection'].forEach(function (sectionId) {
                    var section = container.querySelector('#' + sectionId);
                    if (!section) return;
                    var rows = Array.from(section.querySelectorAll('.tc-manage-row'));
                    var isTagSection = sectionId === 'tcTagSection';

                    rows.forEach(function (row) {
                        var rowName = row.dataset.rowname || '';
                        var nameMatch = !query || rowName.indexOf(query) !== -1;
                        var typeMatch = !isTagSection || rowMatchesTypeFilter(row, selectedGroups);
                        var extrasOk = !isTagSection || includeExtras || (function () {
                            var types = (row.dataset.types || '').split(',').filter(Boolean);
                            return types.length === 0 || !types.every(function (t) { return tcExtraTypes.indexOf(t) !== -1; });
                        })();
                        row.style.display = (nameMatch && typeMatch && extrasOk) ? '' : 'none';
                    });

                    var list = section.querySelector('.tc-manage-list');
                    if (!list) return;
                    var visibleRows = rows.filter(function (r) { return r.style.display !== 'none'; });
                    visibleRows.sort(function (a, b) {
                        var nameA = a.dataset.rowname || '';
                        var nameB = b.dataset.rowname || '';
                        var countA = parseInt(a.dataset.count || '0', 10);
                        var countB = parseInt(b.dataset.count || '0', 10);
                        var managedA = a.dataset.managed === '1';
                        var managedB = b.dataset.managed === '1';
                        if (sort === 'name-asc') return nameA.localeCompare(nameB);
                        if (sort === 'name-desc') return nameB.localeCompare(nameA);
                        if (sort === 'count-desc') return countB - countA;
                        if (sort === 'count-asc') return countA - countB;
                        if (sort === 'managed') return (managedB ? 1 : 0) - (managedA ? 1 : 0) || nameA.localeCompare(nameB);
                        return 0;
                    });
                    visibleRows.forEach(function (r) { list.appendChild(r); });
                });
            }

            container.querySelector('#tcSearch').addEventListener('input', applySearchSort);
            container.querySelector('#tcSort').addEventListener('change', applySearchSort);
            var cbIncludeExtras = container.querySelector('#cbIncludeExtras');
            if (cbIncludeExtras) cbIncludeExtras.addEventListener('change', applySearchSort);

            var typeFilterBtn = container.querySelector('#tcTypeFilterBtn');
            var typeFilterDropdown = container.querySelector('#tcTypeFilterDropdown');
            var typeFilterCaret = container.querySelector('#tcTypeFilterCaret');
            if (typeFilterBtn && typeFilterDropdown) {
                typeFilterBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var open = typeFilterDropdown.classList.toggle('open');
                    if (typeFilterCaret) typeFilterCaret.textContent = open ? 'expand_less' : 'expand_more';
                });
                typeFilterDropdown.addEventListener('change', function (e) {
                    if (e.target.classList.contains('cbTypeFilter')) {
                        updateTypeFilterBtn();
                        applySearchSort();
                    }
                });
                document.addEventListener('click', function closeTypeFilter(e) {
                    if (!typeFilterDropdown.contains(e.target) && !typeFilterBtn.contains(e.target)) {
                        typeFilterDropdown.classList.remove('open');
                        if (typeFilterCaret) typeFilterCaret.textContent = 'expand_more';
                    }
                    if (!container.isConnected) document.removeEventListener('click', closeTypeFilter);
                });
            }

            applySearchSort();

            // ── Hover tooltip: visar vilka objekttyper en tagg finns på ──
            var tcTooltip = document.createElement('div');
            tcTooltip.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:none;' +
                'background:var(--plugin-popup-bg,#2a2a2a);color:var(--plugin-popup-color,#eee);' +
                'border:1px solid var(--plugin-popup-border,#444);border-radius:6px;' +
                'padding:8px 12px;font-size:0.82em;line-height:1.6;max-width:210px;' +
                'box-shadow:0 4px 14px rgba(0,0,0,0.4);';
            document.body.appendChild(tcTooltip);

            // Ta bort tooltip när containern lämnar DOM
            var tcTooltipObserver = new MutationObserver(function () {
                if (!container.isConnected) { tcTooltip.remove(); tcTooltipObserver.disconnect(); }
            });
            if (container.parentNode) tcTooltipObserver.observe(container.parentNode, { childList: true });

            function getTypeLabels(typesStr) {
                var rawTypes = (typesStr || '').split(',').filter(Boolean);
                if (!rawTypes.length) return null;
                var seen = {};
                var labels = [];
                tcTypeGroups.forEach(function (g) {
                    if (!seen[g.label] && rawTypes.some(function (t) { return g.types.indexOf(t) !== -1; })) {
                        seen[g.label] = true;
                        labels.push(g.label);
                    }
                });
                return labels.length ? labels : null;
            }

            var tcTagSection = container.querySelector('#tcTagSection');
            if (tcTagSection) {
                tcTagSection.addEventListener('mouseover', function (e) {
                    var nameEl = e.target.closest('.tc-item-name');
                    if (!nameEl) { tcTooltip.style.display = 'none'; return; }
                    var row = nameEl.closest('.tc-manage-row');
                    if (!row) return;
                    var labels = getTypeLabels(row.dataset.types);
                    if (!labels) { tcTooltip.style.display = 'none'; return; }
                    tcTooltip.innerHTML =
                        '<div style="font-weight:600;opacity:0.55;font-size:0.85em;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">出现于</div>' +
                        labels.map(function (l) {
                            return '<div style="display:flex;align-items:center;gap:6px;">' +
                                '<i class="md-icon" style="font-size:0.95em;opacity:0.7;">label</i>' +
                                escHtml(l) + '</div>';
                        }).join('');
                    tcTooltip.style.display = 'block';
                });
                tcTagSection.addEventListener('mousemove', function (e) {
                    var nameEl = e.target.closest('.tc-item-name');
                    if (!nameEl) { tcTooltip.style.display = 'none'; return; }
                    tcTooltip.style.left = (e.clientX + 16) + 'px';
                    tcTooltip.style.top = (e.clientY + 12) + 'px';
                    var rect = tcTooltip.getBoundingClientRect();
                    if (rect.right > window.innerWidth - 8) tcTooltip.style.left = (e.clientX - rect.width - 16) + 'px';
                    if (rect.bottom > window.innerHeight - 8) tcTooltip.style.top = (e.clientY - rect.height - 12) + 'px';
                });
                tcTagSection.addEventListener('mouseout', function (e) {
                    var nameEl = e.target.closest('.tc-item-name');
                    if (!nameEl) return;
                    if (e.relatedTarget && nameEl.contains(e.relatedTarget)) return;
                    tcTooltip.style.display = 'none';
                });
            }

            function updateSaveButton() {
                var hasPending = Object.keys(pendingTagDeletes).length > 0 || Object.keys(pendingCollDeletes).length > 0;
                container._tcHasPending = hasPending;
                checkFormState();
            }

            if (container._tcClickHandler) container.removeEventListener('click', container._tcClickHandler);
            container._tcClickHandler = function (e) {
                var navLink = e.target.closest('.tc-nav-link');
                if (navLink) {
                    var navId = navLink.dataset.navid;
                    var baseUrl = window.location.href.split('#')[0];
                    var serverId = (window.ApiClient && window.ApiClient.serverId) ? window.ApiClient.serverId() : '';
                    var url = baseUrl + '#!/item?id=' + encodeURIComponent(navId) +
                              (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');
                    window.open(url, '_blank');
                    return;
                }

                var btn = e.target.closest('button');
                if (!btn) return;

                // Mark for deletion
                if (btn.classList.contains('btnTcMark')) {
                    var type = btn.dataset.type;
                    var id = btn.dataset.id;
                    var name = btn.dataset.name;
                    var count = parseInt(btn.dataset.count || '0', 10);
                    if (type === 'tag') pendingTagDeletes[id.toLowerCase()] = { name: name, itemCount: count };
                    else pendingCollDeletes[id] = { id: id, name: name, itemCount: count };
                    var row = btn.closest('.tc-manage-row');
                    if (row) {
                        row.style.opacity = '0.45';
                        var nameEl = row.querySelector('.tc-item-name');
                        if (nameEl) nameEl.style.textDecoration = 'line-through';
                        btn.textContent = '撤销';
                        btn.classList.remove('btnTcMark');
                        btn.classList.add('btnTcUndo');
                        btn.style.background = '#555';
                    }
                    updateSaveButton();
                    return;
                }

                // Undo pending deletion
                if (btn.classList.contains('btnTcUndo')) {
                    var type = btn.dataset.type;
                    var id = btn.dataset.id;
                    if (type === 'tag') delete pendingTagDeletes[id.toLowerCase()];
                    else delete pendingCollDeletes[id];
                    var row = btn.closest('.tc-manage-row');
                    if (row) {
                        row.style.opacity = '1';
                        var nameEl = row.querySelector('.tc-item-name');
                        if (nameEl) nameEl.style.textDecoration = '';
                        btn.textContent = '移除';
                        btn.classList.remove('btnTcUndo');
                        btn.classList.add('btnTcMark');
                        btn.style.background = '#cc3333';
                    }
                    updateSaveButton();
                    return;
                }

                // Refresh
                if (btn.classList.contains('btnTcRefresh')) {
                    container.dataset.loaded = '';
                    loadTagManageTab(view);
                    return;
                }

            };
            container.addEventListener('click', container._tcClickHandler);

            container._tcShowModal = function () { showSummaryModal(); };

            function showSummaryModal() {
                var undoBtnStyle = 'cursor:pointer;border:none;background:transparent;color:#cc2222;border-radius:3px;padding:2px 6px;font-size:1.1em;line-height:1;margin-right:8px;flex-shrink:0;';

                function buildRows(items, isTag) {
                    return items.map(function (item) {
                        var name = item.name;
                        var key = isTag ? item.name.toLowerCase() : item.id;
                        var managed = isTag ? managedTagMap[name.toLowerCase()] : managedCollMap[name.toLowerCase()];
                        var warning = '';
                        var activeManaged = managed ? managed.filter(function (m) { return m.groupActive; }) : [];
                        if (activeManaged.length > 0) {
                            var what = isTag ? '重新创建此标签' : '重新创建此合集';
                            var warningText = activeManaged.length === 1
                                ? '分组 <strong>' + escHtml(activeManaged[0].displayName) + '</strong> 已启用，可能在下次同步时' + what + '。'
                                : activeManaged.length + ' 个已启用的分组可能在下次同步时' + what + '。';
                            var checkboxes = activeManaged.map(function (m) {
                                return '<label style="display:flex;align-items:center;gap:6px;margin-top:5px;cursor:pointer;">' +
                                    '<input type="checkbox" class="cbInactivateGroup" data-group-indices="' + escAttr(JSON.stringify([m.groupIndex])) + '"> ' +
                                    '停用 <strong>' + escHtml(m.displayName) + '</strong>' +
                                    '</label>';
                            }).join('');
                            warning =
                                '<div style="color:#f0a000;margin-top:6px;font-size:0.88em;">' +
                                '<i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:4px;">warning</i>' +
                                warningText + checkboxes + '</div>';
                        }
                        return '<div style="padding:10px 0;border-bottom:1px solid var(--line-color);display:flex;align-items:flex-start;">' +
                            '<button type="button" class="btnModalUndo" style="' + undoBtnStyle + '" data-key="' + escAttr(key) + '" data-type="' + (isTag ? 'tag' : 'coll') + '" title="保留此项">✕</button>' +
                            '<div style="flex:1;">' +
                            '<span style="font-weight:500;">' + escHtml(name) + '</span>' +
                            '<span style="color:var(--theme-text-secondary);font-size:0.88em;margin-left:8px;">(' + item.itemCount + ' 项)</span>' +
                            warning +
                            '</div>' +
                            '</div>';
                    }).join('');
                }

                function buildContent() {
                    var tagList = Object.values(pendingTagDeletes);
                    var collList = Object.values(pendingCollDeletes);
                    var tagSection = tagList.length > 0
                        ? '<div style="margin-bottom:20px;"><h4 style="margin:0 0 8px;color:#52B54B;">待移除的标签 (' + tagList.length + ')</h4>' + buildRows(tagList, true) + '</div>'
                        : '';
                    var collSection = collList.length > 0
                        ? '<div style="margin-bottom:20px;"><h4 style="margin:0 0 8px;color:#52B54B;">待移除的合集 (' + collList.length + ')</h4>' + buildRows(collList, false) + '</div>'
                        : '';
                    return tagSection + collSection;
                }

                var modal = document.createElement('div');
                modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;';

                function renderModal() {
                    var tagList = Object.values(pendingTagDeletes);
                    var collList = Object.values(pendingCollDeletes);
                    if (tagList.length === 0 && collList.length === 0) { modal.remove(); updateSaveButton(); return; }
                    modal.innerHTML =
                        '<div style="background:var(--plugin-popup-bg,#2a2a2a);color:var(--plugin-popup-color,#e8e8e8);border:1px solid var(--plugin-popup-border,rgba(255,255,255,0.12));border-radius:8px;padding:28px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;">' +
                        '<h3 style="margin:0 0 20px;font-size:1.1em;color:#52B54B;">摘要 — 待保存的更改</h3>' +
                        '<div id="tcModalBody">' + buildContent() + '</div>' +
                        '<div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px;border-top:1px solid var(--line-color);padding-top:16px;">' +
                        '<button type="button" id="tcModalCancel" style="cursor:pointer;border:1px solid var(--line-color);background:transparent;color:var(--theme-text-primary);border-radius:3px;padding:8px 18px;font-size:0.9em;">取消</button>' +
                        '<button type="button" id="tcModalConfirm" style="cursor:pointer;border:none;background:#52B54B;color:#fff;border-radius:3px;padding:8px 18px;font-size:0.9em;font-weight:500;"><i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:5px;">check</i>确认并保存</button>' +
                        '</div></div>';

                    modal.querySelector('#tcModalCancel').addEventListener('click', function () { modal.remove(); });

                    modal.addEventListener('click', function (e) {
                        var undoBtn = e.target.closest('.btnModalUndo');
                        if (!undoBtn) return;
                        var type = undoBtn.dataset.type;
                        var key = undoBtn.dataset.key;
                        if (type === 'tag') delete pendingTagDeletes[key];
                        else delete pendingCollDeletes[key];

                        // Restore the row in the main list directly (no .click() to avoid re-triggering handler)
                        var keyLower = key.toLowerCase();
                        var mainBtn = Array.from(container.querySelectorAll('.btnTcUndo')).find(function (b) { return b.dataset.id.toLowerCase() === keyLower; });
                        if (mainBtn) {
                            var row = mainBtn.closest('.tc-manage-row');
                            if (row) {
                                row.style.opacity = '1';
                                var nameEl = row.querySelector('.tc-item-name');
                                if (nameEl) nameEl.style.textDecoration = '';
                            }
                            mainBtn.textContent = '移除';
                            mainBtn.classList.remove('btnTcUndo');
                            mainBtn.classList.add('btnTcMark');
                            mainBtn.style.background = '#cc3333';
                        }

                        updateSaveButton();
                        renderModal();
                    });

                    modal.querySelector('#tcModalConfirm').addEventListener('click', function () {
                        var confirmBtn = modal.querySelector('#tcModalConfirm');
                        confirmBtn.disabled = true;
                        confirmBtn.innerHTML = '正在保存 <span class="tc-dot-loader"><span></span><span></span><span></span></span>';

                        var tagList = Object.values(pendingTagDeletes);
                        var collList = Object.values(pendingCollDeletes);

                        var groupsToInactivate = new Set();
                        modal.querySelectorAll('.cbInactivateGroup:checked').forEach(function (cb) {
                            var indices = cb.dataset.groupIndices ? JSON.parse(cb.dataset.groupIndices) : [];
                            indices.forEach(function (idx) { groupsToInactivate.add(idx); });
                        });

                        var tok = window.ApiClient.accessToken();

                        // All tags in one batch request — avoids race conditions when items carry multiple managed tags
                        var tagBatchPromise = tagList.length === 0 ? Promise.resolve() :
                            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Manage/DeleteTags'), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-MediaBrowser-Token': tok },
                                body: JSON.stringify({ TagNames: tagList.map(function (t) { return t.name; }) })
                            }).then(function (r) { return r.json(); });

                        // Collections are independent — run sequentially after tags
                        var collOps = [];
                        collList.forEach(function (c) {
                            collOps.push(function () {
                                return fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Manage/DeleteCollection'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'X-MediaBrowser-Token': tok },
                                    body: JSON.stringify({ CollectionId: c.id })
                                }).then(function (r) { return r.json(); });
                            });
                        });

                        tagBatchPromise.then(function () {
                            return collOps.reduce(function (chain, op) { return chain.then(op); }, Promise.resolve());
                        }).then(function () {
                            if (groupsToInactivate.size === 0) return Promise.resolve();
                            return window.ApiClient.getPluginConfiguration(pluginId).then(function (cfg) {
                                // Collect the Tag values for the seed indices, then inactivate ALL rows sharing that Tag
                                var tagsToInactivate = new Set();
                                groupsToInactivate.forEach(function (idx) {
                                    if (cfg.Tags && cfg.Tags[idx] && cfg.Tags[idx].Tag)
                                        tagsToInactivate.add(cfg.Tags[idx].Tag.trim().toLowerCase());
                                });
                                (cfg.Tags || []).forEach(function (t) {
                                    if (t.Tag && tagsToInactivate.has(t.Tag.trim().toLowerCase()))
                                        t.Active = false;
                                });
                                return window.ApiClient.updatePluginConfiguration(pluginId, cfg);
                            });
                        }).then(function () {
                            modal.remove();
                            // Update SOURCES tab rows for deactivated groups immediately.
                            // groupsToInactivate holds seed indices; find all rows sharing the same Tag value.
                            var inactivatedTagKeys = new Set();
                            groupsToInactivate.forEach(function (idx) {
                                var seedRow = view.querySelector('#tagListContainer .tag-row[data-index="' + idx + '"]');
                                if (seedRow && seedRow.dataset.tag) inactivatedTagKeys.add(seedRow.dataset.tag.toLowerCase());
                            });
                            view.querySelectorAll('#tagListContainer .tag-row').forEach(function (sourceRow) {
                                var rowTag = (sourceRow.dataset.tag || '').toLowerCase();
                                if (!inactivatedTagKeys.has(rowTag)) return;
                                var chk = sourceRow.querySelector('.chkTagActive');
                                var lbl = sourceRow.querySelector('.lblActiveStatus');
                                if (chk) chk.checked = false;
                                if (lbl) { lbl.textContent = '已禁用'; lbl.style.color = 'var(--theme-text-secondary)'; }
                                sourceRow.classList.add('inactive');
                                var runBtn = sourceRow.querySelector('.btnRunEntry');
                                if (runBtn) { runBtn.disabled = true; runBtn.style.opacity = '0.4'; }
                            });
                            pendingTagDeletes = {};
                            pendingCollDeletes = {};
                            container._tcHasPending = false;
                            checkFormState();
                            container.dataset.loaded = '';
                            loadTagManageTab(view);
                        }).catch(function (err) {
                            modal.remove();
                            alert('保存出错：' + err);
                        });
                    });
                }

                renderModal();
                document.body.appendChild(modal);
            }

        }).catch(function (err) {
            container.innerHTML = '<div style="color:#cc3333;padding:20px;">加载失败：' + err + '</div>';
        });
    }

    function executeTopListCreationSteps(tagName, displayName, selectedUserIds, displayMode, customName, imageType, maxItems, prepareResult, ui, onSuccess) {
        var saveBtn    = ui.saveBtn;
        var errEl      = ui.errEl;
        var modal      = ui.modal;
        var badgeStyle = ui.badgeStyle || 'neutral';
        var isShows    = ui.contentType === 'Shows';
        var tok = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
        var snapshotId = null;
        var pendingLibraryId = null;

        saveBtn.innerHTML = '正在创建媒体库 <span class="tc-dot-loader"><span></span><span></span><span></span></span>';

        // Step 0: Snapshot all user policies server-side BEFORE library creation.
        // POST Library/VirtualFolders causes Emby to set EnableAllFolders=true for all users.
        // The server stores the exact per-user state and restores it in step 4b.
        // The chain is returned so silent callers (backup restore) can await it.
        return fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/SnapshotPolicies'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok },
            body: JSON.stringify({})
        })
        .then(function(r) { return r.json(); })
        .then(function(result) {
            if (result && result.SnapshotId) {
                snapshotId = result.SnapshotId;
                console.log('[HSC] 已创建策略快照：', result.UserCount, '位用户，ID：', snapshotId);
            }
        }).catch(function() {})
        .then(function() {

        // Steps 2+3: Check if the virtual library already exists before creating it.
        // POSTing to Library/VirtualFolders — even for an already-existing library — causes
        // Emby to update all users' policies and fire "User Policy Updated" notifications.
        // By skipping the POST when the library is already present we avoid spurious notifications.
        return fetch(window.ApiClient.getUrl('Library/VirtualFolders'), {
            headers: { 'X-MediaBrowser-Token': tok }
        })
        .then(function (r) { return r.json(); })
        .then(function (existingFolders) {
            // Normalize path separators and strip trailing slashes before comparing,
            // since the C# backend uses backslashes on Windows while Emby's API may
            // return forward slashes (or vice versa).
            function normLibPath(p) { return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }
            var targetPath = normLibPath(prepareResult.FolderPath);
            // Record all library IDs before creation so we can find the new one by diff
            // if path matching fails (Emby may not register the library synchronously).
            var preCreationIds = new Set((existingFolders || []).map(function (f) { return f.ItemId; }).filter(Boolean));
            var alreadyExists = (existingFolders || []).some(function (f) {
                return (f.Locations || []).some(function (loc) {
                    return normLibPath(loc) === targetPath;
                });
            });
            if (alreadyExists) {
                return { folders: existingFolders, preCreationIds: new Set() };
            }
            // Library doesn't exist yet — create it, then re-fetch the updated list.
            // A show list's library only holds copies the plugin writes complete (nfo + images
            // linked from the originals), so it needs no online metadata, and it stays out of
            // search where every show would otherwise appear twice.
            var libraryOptions = isShows
                ? {
                    EnableInternetProviders: false,
                    ExcludeFromSearch: true,
                    TypeOptions: ['Series', 'Season', 'Episode'].map(function (t) {
                        return { Type: t, MetadataFetchers: ['Nfo'], MetadataFetcherOrder: ['Nfo'], ImageFetchers: [], ImageFetcherOrder: [] };
                    })
                }
                : {
                    EnableInternetProviders: true,
                    TypeOptions: [{
                        Type: 'Movie',
                        MetadataFetchers: ['Nfo', 'TheMovieDb', 'TheTVDB'],
                        MetadataFetcherOrder: ['Nfo', 'TheMovieDb', 'TheTVDB'],
                        ImageFetchers: ['TheMovieDb', 'TheTVDB'],
                        ImageFetcherOrder: ['TheMovieDb', 'TheTVDB']
                    }]
                };
            return fetch(window.ApiClient.getUrl('Library/VirtualFolders'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok },
                body: JSON.stringify({
                    Name: customName,
                    CollectionType: isShows ? 'tvshows' : 'movies',
                    RefreshLibrary: false,
                    Paths: [prepareResult.FolderPath],
                    LibraryOptions: libraryOptions
                })
            }).catch(function () {})
            .then(function () {
                // Emby may register the new library asynchronously — re-fetch a few times until
                // it shows up, otherwise the library id stays 'auto' and nothing gets scanned.
                function fetchUntilRegistered(attempt) {
                    return fetch(window.ApiClient.getUrl('Library/VirtualFolders'), {
                        headers: { 'X-MediaBrowser-Token': tok }
                    }).then(function (r) { return r.json(); })
                    .then(function (folders) {
                        var found = (folders || []).some(function (f) {
                            return f.ItemId && (f.Locations || []).some(function (loc) {
                                return normLibPath(loc) === targetPath;
                            });
                        });
                        if (found || attempt >= 10) return folders;
                        return new Promise(function (res) { setTimeout(res, 1000); })
                            .then(function () { return fetchUntilRegistered(attempt + 1); });
                    });
                }
                return fetchUntilRegistered(1);
            })
            .then(function (newFolders) {
                return { folders: newFolders, preCreationIds: preCreationIds };
            });
        })
        .then(function (result) {
            saveBtn.innerHTML = '正在保存设置 <span class="tc-dot-loader"><span></span><span></span><span></span></span>';

            var folders = result.folders;
            var preCreationIds = result.preCreationIds;

            // Find the library by its folder path to get its ItemId
            function normLibPath2(p) { return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }
            var match = (folders || []).find(function (f) {
                return (f.Locations || []).some(function (loc) {
                    return normLibPath2(loc) === normLibPath2(prepareResult.FolderPath);
                });
            });
            var newLibId = match ? match.ItemId : null;

            // Fallback: if path matching failed (timing issue), find the new library by
            // comparing current IDs against the pre-creation snapshot.
            if (!newLibId && preCreationIds.size > 0) {
                var diffMatch = (folders || []).find(function (f) {
                    return f.ItemId && !preCreationIds.has(f.ItemId);
                });
                if (diffMatch) newLibId = diffMatch.ItemId;
            }

            // Same view list Emby's section editor offers under "Libraries" (hidden libraries and
            // channels included), for every selected user — anything missing stays ticked.
            var viewsPromise = Promise.all(selectedUserIds.map(function (userId) {
                return fetch(window.ApiClient.getUrl('Users/' + userId + '/Views', { IncludeHidden: true, AllowDynamicChildren: false }), { headers: { 'X-MediaBrowser-Token': tok } })
                    .then(function (r) { return r.json(); })
                    .catch(function () { return { Items: [] }; });
            }));

            return viewsPromise.then(function (viewsResults) {
                var allViewIds = new Set();
                (folders || []).forEach(function (f) { if (f.ItemId && f.ItemId !== newLibId) allViewIds.add(f.ItemId); });
                viewsResults.forEach(function (viewsResult) {
                    ((viewsResult && viewsResult.Items) || []).forEach(function (v) {
                        if (!v.Id || (newLibId && (v.Id === newLibId || v.Guid === newLibId))) return;
                        allViewIds.add(v.Id);
                    });
                });
                var excludedViewIds = Array.from(allViewIds).join(',');
                return { prepareResult: prepareResult, libraryItemId: newLibId, excludedViewIds: excludedViewIds };
            });
        })
        .then(function (ctx) {
            // Step 4: Save top-list home section config
            return window.ApiClient.getPluginConfiguration(pluginId).then(function (config) {
                var topLists = config.TopLists || [];
                var existing = topLists.find(function (t) {
                    return (t.TagName || '').toLowerCase() === tagName.toLowerCase();
                });
                var hseSettings = JSON.stringify({
                    SectionType: 'items',
                    DisplayMode: displayMode,
                    CustomName: customName,
                    MaxItems: String(maxItems),
                    ViewType: '',
                    ImageType: imageType,
                    BadgeStyle: badgeStyle,
                    SortBy: 'SortName',
                    SortOrder: 'Ascending',
                    ScrollDirection: '',
                    ItemTypes: JSON.stringify([isShows ? 'Series' : 'Movie']),
                    _queryIsPlayed: '',
                    _queryExcludeViewIds: ctx.excludedViewIds,
                    ExcludedFolders: ctx.excludedViewIds
                });
                if (existing) {
                    existing.HomeSectionUserIds = selectedUserIds;
                    existing.HomeSectionLibraryId = ctx.libraryItemId || 'auto';
                    existing.HomeSectionSettings = hseSettings;
                    existing.HomeSectionTracked = existing.HomeSectionTracked || [];
                    existing.MaxItems = maxItems;
                    existing.ContentType = isShows ? 'Shows' : 'Movies';
                } else {
                    topLists.push({
                        TagName: tagName,
                        MaxItems: maxItems,
                        HomeSectionUserIds: selectedUserIds,
                        HomeSectionLibraryId: ctx.libraryItemId || 'auto',
                        HomeSectionSettings: hseSettings,
                        HomeSectionTracked: [],
                        ContentType: isShows ? 'Shows' : 'Movies'
                    });
                }
                config.TopLists = topLists;
                return window.ApiClient.updatePluginConfiguration(pluginId, config)
                    .then(function () { return { prepareResult: ctx.prepareResult, libraryItemId: ctx.libraryItemId }; });
            });
        })
        .then(function (ctx2) {
            // Step 4b: Store the library ID for the final access-restore step.
            // RestoreAndGrantAccess runs AFTER the library scan (last step) to ensure Emby
            // has fully registered the new library before we write it to EnabledFolders.
            if (ctx2.libraryItemId) pendingLibraryId = ctx2.libraryItemId;
            return ctx2;
        })
        .then(function (ctx2) {
            // Step 5: Create home sections immediately
            saveBtn.innerHTML = '正在创建主屏幕栏目 <span class="tc-dot-loader"><span></span><span></span><span></span></span>';
            var tok5 = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
            return fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/SyncHomeSections'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok5 },
                body: JSON.stringify({ TagName: tagName })
            })
            .then(function (r) { return r.json(); })
            .then(function (syncResult) {
                if (!syncResult.Success) throw new Error(syncResult.Message || '创建主屏幕栏目失败。');
                return ctx2;
            });
        })
        .then(function (ctx2) {
            // Step 6: Scan the new library so Emby indexes and identifies the .strm files.
            // The library is created with RefreshLibrary=false and the files were written before
            // it existed, so without this scan the library (and the home section) stays empty.
            saveBtn.innerHTML = '正在扫描媒体库 <span class="tc-dot-loader"><span></span><span></span><span></span></span>';
            var tok6 = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
            var scanOwnLibrary = ctx2.libraryItemId
                ? fetch(window.ApiClient.getUrl('Items/' + ctx2.libraryItemId + '/Refresh') + '?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default', {
                    method: 'POST',
                    headers: { 'X-MediaBrowser-Token': tok6 }
                }).then(function (r) { return r.ok; }).catch(function () { return false; })
                : Promise.resolve(false);
            return scanOwnLibrary.then(function (ok) {
                if (ok) return;
                // Fallback: full library scan (also picks up the new library's files).
                console.warn('[HSC] 榜单媒体库刷新失败 — 改为扫描全部媒体库。');
                return fetch(window.ApiClient.getUrl('Library/Refresh'), {
                    method: 'POST',
                    headers: { 'X-MediaBrowser-Token': tok6 }
                }).catch(function () {});
            })
            .then(function () {
                // Step 6b: Wait until the scan has indexed + identified the files, so the
                // final section sync runs against a populated library.
                var expected = ctx2.prepareResult.FilesCreated || 0;
                if (!expected) return;
                var deadline = Date.now() + 120000;
                function poll() {
                    return fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/IndexStatus', { FolderPath: ctx2.prepareResult.FolderPath }), {
                        headers: { 'X-MediaBrowser-Token': tok6 }
                    })
                    .then(function (r) { return r.json(); })
                    .catch(function () { return null; })
                    .then(function (st) {
                        if (!st || !st.Success) return;
                        saveBtn.innerHTML = '正在识别 ' + (isShows ? '剧集' : '电影') + ' (' + Math.min(st.Identified, expected) + '/' + expected + ') <span class="tc-dot-loader"><span></span><span></span><span></span></span>';
                        if (st.Indexed >= expected && st.Identified >= st.Indexed) return;
                        if (Date.now() > deadline) {
                            console.warn('[HSC] 榜单扫描超时后仍在运行 — 已索引 ' + st.Indexed + '/' + expected + '，已识别 ' + st.Identified + '。');
                            return;
                        }
                        return new Promise(function (res) { setTimeout(res, 2000); }).then(poll);
                    });
                }
                return poll();
            })
            .then(function () { return ctx2.prepareResult; });
        })
        .then(function (prepareResult) {
            // NOTE: Linking each .strm as an alternate version of its original movie AND probing it
            // for a real RunTimeTicks (so resume works instead of marking the film fully-watched) is
            // handled automatically server-side by the ItemAdded/ItemUpdated hook in ServerEntryPoint,
            // which fires as Emby indexes each .strm. No UI step is needed here — hence the
            // "finishing touches will continue in the background" note on the success screen.
            // Step 7: Sync all top-list home sections so exclusion lists are up to date
            var tok7 = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
            return fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/SyncAllSections'), {
                method: 'POST',
                headers: { 'X-MediaBrowser-Token': tok7 }
            }).catch(function () {}).then(function () { return prepareResult; });
        })
        .then(function (prepareResult) {
            // Step 8: Grant library access to all restricted users via Emby's standard
            // user-policy API (GET /Users + POST /Users/{Id}/Policy).
            // This avoids server-side reflection entirely and works with any Emby version.
            // Users with EnableAllFolders=true already have access — skip them.
            // Users with EnableAllFolders=false get the new library added to EnabledFolders
            // without touching any of their other existing settings.
            if (!pendingLibraryId) return prepareResult;
            var tok8 = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
            var libIdLower = pendingLibraryId.toLowerCase();
            return fetch(window.ApiClient.getUrl('Users'), {
                headers: { 'X-MediaBrowser-Token': tok8 }
            })
            .then(function (r) { return r.json(); })
            .then(function (users) {
                // GET /Users may return Policy=null for users other than the caller in
                // some Emby versions. Fetch each user individually to guarantee full Policy data.
                return Promise.all((users || []).map(function (u) {
                    if (u && u.Policy) return Promise.resolve(u);
                    return fetch(window.ApiClient.getUrl('Users/' + u.Id), {
                        headers: { 'X-MediaBrowser-Token': tok8 }
                    }).then(function (r) { return r.json(); }).catch(function () { return u; });
                }));
            })
            .then(function (users) {
                var updates = (users || [])
                    .filter(function (u) {
                        return u && u.Policy && !u.Policy.EnableAllFolders &&
                            selectedUserIds.some(function (id) { return id.toLowerCase() === (u.Id || '').toLowerCase(); }) &&
                            !(u.Policy.EnabledFolders || []).some(function (f) {
                                return (f || '').toLowerCase() === libIdLower;
                            });
                    })
                    .map(function (u) {
                        var pol = JSON.parse(JSON.stringify(u.Policy));
                        pol.EnabledFolders = (u.Policy.EnabledFolders || []).concat([pendingLibraryId]);
                        return fetch(window.ApiClient.getUrl('Users/' + u.Id + '/Policy'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-MediaBrowser-Token': tok8 },
                            body: JSON.stringify(pol)
                        }).catch(function () {});
                    });
                return Promise.all(updates);
            })
            .catch(function () {})
            .then(function () { return prepareResult; });
        })
        .then(function (prepareResult) {
            _topListTagNames.add(tagName.toLowerCase());
            refreshTopListBadges();
            if (ui.silent && typeof ui.closeHandler === 'function') { ui.closeHandler(); return; }
            var innerBox = ui.innerBox || modal.querySelector('div');
            innerBox.innerHTML =
                '<div style="text-align:center;padding:10px 0 20px;">' +
                '<i class="md-icon" style="font-size:2.5em;color:#52B54B;display:block;margin-bottom:12px;">check_circle</i>' +
                '<p style="margin:0 0 6px;font-size:1.05em;font-weight:500;">榜单已创建！</p>' +
                '<p style="margin:0;opacity:0.65;font-size:0.9em;">' + prepareResult.FilesCreated + (isShows ? ' 部剧集' : ' 部电影') + (prepareResult.FilesCreated !== 1 ? '' : '') + '已收录。</p>' +
                '<p style="margin:8px 0 0;opacity:0.5;font-size:0.82em;font-style:italic;">收尾工作将在后台继续进行。</p>' +
                '</div>' +
                '<div style="display:flex;justify-content:center;padding-top:16px;border-top:1px solid var(--line-color);margin-top:20px;">' +
                '<button type="button" class="btnTlmDone" style="cursor:pointer;border:none;background:#52B54B;color:#fff;border-radius:3px;padding:8px 22px;font-size:0.9em;font-weight:500;">关闭</button>' +
                '</div>';
            innerBox.querySelector('.btnTlmDone').addEventListener('click', function () {
                if (typeof ui.closeHandler === 'function') { ui.closeHandler(); }
                else { modal.remove(); if (typeof onSuccess === 'function') onSuccess(); }
            });
        })
        .catch(function (err) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:6px;">check</i>保存并应用';
            errEl.textContent = err.message || String(err);
            if (ui.silent) throw err;
        });
        }); // end step 0 wrapper
    }

    var _badgeStyles = [
        { val: 'neutral',    label: '中性',    bg: 'rgba(0,0,0,0.82)',        textColor: '#fff' },
        { val: 'slate-grey', label: '石板灰', bg: 'rgba(65,65,75,0.88)',     textColor: '#fff' },
        { val: 'emby-green', label: 'Emby 绿', bg: 'rgba(82,181,75,0.78)',    textColor: '#fff' },
        { val: 'ocean-blue', label: '海洋蓝', bg: 'rgba(46,134,193,0.82)',   textColor: '#fff' },
        { val: 'soft-red',   label: '柔和红',   bg: 'rgba(201,69,69,0.82)',    textColor: '#fff' },
        { val: 'violet',     label: '紫罗兰',     bg: 'rgba(123,82,181,0.82)',   textColor: '#fff' },
        { val: 'none',       label: '无数字',  bg: 'transparent',             textColor: '#fff', noNumber: true }
    ];

    function buildBadgePickerHtml(selectedVal) {
        var sel = selectedVal || 'neutral';
        var cardBase = 'cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 12px;border-radius:6px;border:2px solid transparent;transition:border-color 0.15s;';
        var cardActive = cardBase + 'border-color:#52B54B;';
        var cardInactive = cardBase + 'border-color:var(--line-color,rgba(255,255,255,0.12));';
        return '<div style="margin-bottom:16px;">' +
            '<span style="font-size:0.82em;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;opacity:0.65;display:block;margin-bottom:8px;">角标样式</span>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            _badgeStyles.map(function (s) {
                var active = s.val === sel;
                return '<label class="tl-badge-opt" style="' + (active ? cardActive : cardInactive) + '">' +
                    '<input type="radio" name="tlBadgeStyle" value="' + s.val + '" style="position:absolute;opacity:0;pointer-events:none;"' + (active ? ' checked' : '') + '>' +
                    '<div style="width:46px;height:46px;border-radius:50%;background:' + s.bg + ';display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:' + s.textColor + ';font-family:sans-serif;">' + (s.noNumber ? '' : '7') + '</div>' +
                    '<span style="font-size:0.78em;opacity:0.8;white-space:nowrap;">' + s.label + '</span>' +
                    '</label>';
            }).join('') +
            '</div></div>';
    }

    function initBadgePicker(container) {
        var cardBase = 'cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 12px;border-radius:6px;border:2px solid transparent;transition:border-color 0.15s;';
        var opts = Array.from(container.querySelectorAll('.tl-badge-opt'));
        opts.forEach(function (label) {
            label.addEventListener('click', function () {
                opts.forEach(function (l) { l.style.borderColor = 'var(--line-color,rgba(255,255,255,0.12))'; });
                label.style.borderColor = '#52B54B';
            });
        });
    }

    function readBadgeStyle(container) {
        var checked = container.querySelector('input[name="tlBadgeStyle"]:checked');
        return checked ? checked.value : 'neutral';
    }

    // contentType: 'Movies' (default) or 'Shows'
    function showTopListModal(tagName, displayName, onSuccess, existingData, contentType) {
        var isShows = contentType === 'Shows';
        function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
        function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

        var inputStyle = 'background:var(--plugin-input-bg);border:1px solid var(--plugin-input-border);border-radius:4px;padding:6px 10px;font-size:0.9em;color:var(--plugin-popup-color);width:100%;box-sizing:border-box;';
        var labelStyle = 'font-size:0.82em;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;opacity:0.65;display:block;margin-bottom:5px;';
        var fieldStyle = 'margin-bottom:16px;';

        var modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;';

        function renderBox(content) {
            modal.innerHTML =
                '<div style="background:var(--plugin-popup-bg,#2a2a2a);color:var(--plugin-popup-color,#e8e8e8);' +
                'border:1px solid var(--plugin-popup-border,rgba(255,255,255,0.12));border-radius:8px;' +
                'padding:28px;max-width:520px;width:90%;max-height:85vh;overflow-y:auto;">' +
                content + '</div>';
        }

        renderBox('<div style="padding:10px 0;display:flex;align-items:center;gap:10px;">正在加载 <span class="tc-dot-loader"><span></span><span></span><span></span></span></div>');
        document.body.appendChild(modal);

        getHseUsers().then(function (users) {
            var usersHtml = buildUserMultiSelectHtml(
                users,
                existingData ? (existingData.userIds || []) : [],
                'chkTlmUser'
            );


            var html =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;">' +
                '<h3 style="margin:0;font-size:1.1em;color:#52B54B;">' + (existingData ? '编辑' : '创建') + (isShows ? ' 剧集' : '') + ' 榜单：' + escHtml(displayName) + '</h3>' +
                '<button type="button" class="btnTlmClose" style="background:transparent;border:none;color:inherit;cursor:pointer;padding:2px;opacity:0.6;line-height:1;"><i class="md-icon">close</i></button>' +
                '</div>' +

                '<div style="' + fieldStyle + '">' +
                '<span style="' + labelStyle + '">目标用户</span>' +
                '<div class="tlm-user-list">' + usersHtml + '</div>' +
                '</div>' +

                '<div style="' + fieldStyle + '">' +
                '<label style="' + labelStyle + '">显示此栏目</label>' +
                '<select is="emby-select" class="tlm-display-mode" style="width:100%;">' +
                '<option value="">始终</option>' +
                '<option value="tv">电视模式开启时</option>' +
                '<option value="mobile,desktop">电视模式关闭时</option>' +
                '</select></div>' +

                '<div style="' + fieldStyle + '">' +
                '<label style="' + labelStyle + '">自定义标题</label>' +
                '<input type="text" class="tlm-custom-name" style="' + inputStyle + '" placeholder="' + escAttr(displayName) + '" />' +
                '</div>' +

                '<div style="' + fieldStyle + '">' +
                '<label style="' + labelStyle + '">图片类型</label>' +
                '<select is="emby-select" class="tlm-image-type" style="width:100%;">' +
                '<option value="">自动</option>' +
                '<option value="Primary">主图</option>' +
                '<option value="Thumb">缩略图</option>' +
                '</select></div>' +

                buildBadgePickerHtml(existingData ? existingData.badgeStyle : 'neutral') +

                '<div style="' + fieldStyle + '">' +
                '<label style="' + labelStyle + '">最大项目数 <span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:0.7;">（0 = 全部）</span></label>' +
                '<input type="number" class="tlm-max-items" min="0" step="1" style="' + inputStyle + '" placeholder="0" />' +
                '</div>' +

                '<div class="tlm-error" style="color:#cc3333;font-size:0.85em;min-height:1.2em;margin-bottom:4px;"></div>' +
                '<div style="border-top:1px solid var(--line-color);padding-top:16px;display:flex;gap:10px;align-items:center;justify-content:flex-end;">' +
                '<button type="button" class="btnTlmCancel" style="cursor:pointer;border:1px solid var(--line-color);background:transparent;color:var(--theme-text-primary);border-radius:3px;padding:8px 18px;font-size:0.9em;">取消</button>' +
                '<button type="button" class="btnTlmSave" style="cursor:pointer;border:none;background:#52B54B;color:#fff;border-radius:4px;padding:10px 26px;font-size:0.95em;font-weight:600;">' +
                '<i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:6px;">check</i>保存并应用</button>' +
                '</div>';

            renderBox(html);
            initBadgePicker(modal);
            wireUserMultiSelect(modal);

            if (existingData) {
                if (existingData.customName) modal.querySelector('.tlm-custom-name').value = existingData.customName;
                if (existingData.displayMode) modal.querySelector('.tlm-display-mode').value = existingData.displayMode;
                if (existingData.imageType) modal.querySelector('.tlm-image-type').value = existingData.imageType;
                if (existingData.maxItems && existingData.maxItems !== '0') modal.querySelector('.tlm-max-items').value = existingData.maxItems;
            }

            modal.querySelector('.btnTlmClose').addEventListener('click', function () { modal.remove(); });
            modal.querySelector('.btnTlmCancel').addEventListener('click', function () { modal.remove(); });
            modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

            modal.querySelector('.btnTlmSave').addEventListener('click', function () {
                var saveBtn = this;
                var errEl = modal.querySelector('.tlm-error');
                errEl.textContent = '';

                var selectedUserIds = Array.from(modal.querySelectorAll('.chkTlmUser:checked')).map(function (c) { return c.value; });
                if (selectedUserIds.length === 0) {
                    errEl.textContent = '请至少选择一位目标用户。';
                    return;
                }

                var customName    = modal.querySelector('.tlm-custom-name').value.trim() || displayName;
                var displayMode   = modal.querySelector('.tlm-display-mode').value;
                var imageType     = modal.querySelector('.tlm-image-type').value;
                var badgeStyle    = readBadgeStyle(modal);
                var maxItems      = Math.max(0, parseInt(modal.querySelector('.tlm-max-items').value, 10) || 0);
                var tok = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';

                saveBtn.disabled = true;
                saveBtn.innerHTML = '正在准备文件 <span class="tc-dot-loader"><span></span><span></span><span></span></span>'; 

                // Step 1: Create folder + write .strm files
                fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/PrepareFolder'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok },
                    body: JSON.stringify({ TagName: tagName, MaxItems: maxItems, BadgeStyle: badgeStyle, ContentType: isShows ? 'Shows' : 'Movies' })
                })
                .then(function (r) { return r.json(); })
                .then(function (prepareResult) {
                    if (!prepareResult.Success) throw new Error(prepareResult.Message || '创建文件夹失败。');
                    if (isShows && !prepareResult.FilesCreated) throw new Error('没有带有此标签且包含单集文件的剧集。');
                    executeTopListCreationSteps(
                        tagName, displayName, selectedUserIds, displayMode, customName, imageType, maxItems,
                        prepareResult, { saveBtn: saveBtn, errEl: errEl, modal: modal, badgeStyle: badgeStyle, contentType: isShows ? 'Shows' : 'Movies' }, onSuccess
                    );
                })
                .catch(function (err) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:6px;">check</i>保存并应用';
                    errEl.textContent = err.message || String(err);
                });
            });
        }).catch(function (err) {
            renderBox('<div style="color:#cc3333;padding:10px 0;">加载失败：' + (err.message || err) + '</div>' +
                '<div style="margin-top:16px;text-align:right;"><button type="button" class="btnTlmClose" style="cursor:pointer;border:1px solid var(--line-color);background:transparent;color:inherit;border-radius:3px;padding:6px 14px;font-size:0.9em;">关闭</button></div>');
            modal.querySelector('.btnTlmClose').addEventListener('click', function () { modal.remove(); });
        });
    }

    // existingData = { listName, customName, displayMode, imageType, userIds: [], movies: [{ItemId,ImdbId,Name,Year}] }
    // contentType: 'Movies' (default) or 'Shows' — for shows, "movies" below are series.
    function showManualTopListModal(onSuccess, existingData, contentType) {
        function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
        function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

        var isShows = contentType === 'Shows';
        var itemWord = isShows ? '剧集' : '电影';
        var isEdit = !!existingData;
        var inputStyle = 'background:var(--plugin-input-bg);border:1px solid var(--plugin-input-border);border-radius:4px;padding:6px 10px;font-size:0.9em;color:var(--plugin-popup-color);width:100%;box-sizing:border-box;';
        var labelStyle = 'font-size:0.82em;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;opacity:0.65;display:block;margin-bottom:5px;';
        var fieldStyle = 'margin-bottom:14px;';
        var colHeaderStyle = 'font-size:0.75em;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#52B54B;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid rgba(82,181,75,0.3);';

        var modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML =
            '<div style="background:var(--plugin-popup-bg,#2a2a2a);color:var(--plugin-popup-color,#e8e8e8);' +
            'border:1px solid var(--plugin-popup-border,rgba(255,255,255,0.12));border-radius:8px;' +
            'padding:28px;max-width:720px;width:95%;max-height:90vh;overflow-y:auto;">' +
            '<div style="padding:10px 0;display:flex;align-items:center;gap:10px;">正在加载 <span class="tc-dot-loader"><span></span><span></span><span></span></span></div>' +
            '</div>';
        document.body.appendChild(modal);

        function onEsc(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onEsc); } }
        document.addEventListener('keydown', onEsc);
        modal.addEventListener('click', function (e) { if (e.target === modal) { modal.remove(); document.removeEventListener('keydown', onEsc); } });

        var tok = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';

        Promise.all([
            fetch(window.ApiClient.getUrl(isShows ? 'HomeScreenCompanionAnime/TopList/AllSeries' : 'HomeScreenCompanionAnime/TopList/AllMovies'), {
                headers: { 'X-MediaBrowser-Token': tok }
            }).then(function (r) { return r.json(); }),
            getHseUsers()
        ])
        .then(function (results) {
            var allMovies = (results[0].Movies || []);
            var users     = results[1];

            var presetUserIds = (existingData && existingData.userIds) || [];

            var usersHtml = buildUserMultiSelectHtml(users, presetUserIds, 'chkMtlUser');


            var presetName       = (existingData && existingData.listName)    || '';
            var presetCustomName = (existingData && existingData.customName)  || '';
            var presetDisplay    = (existingData && existingData.displayMode) || '';
            var presetImageType  = (existingData && existingData.imageType)   || '';
            var presetBadgeStyle = (existingData && existingData.badgeStyle)  || 'neutral';

            var displayOptions = [
                { val: '',               label: '始终' },
                { val: 'tv',             label: '电视模式开启时' },
                { val: 'mobile,desktop', label: '电视模式关闭时' }
            ].map(function (o) {
                return '<option value="' + escAttr(o.val) + '"' + (o.val === presetDisplay ? ' selected' : '') + '>' + escHtml(o.label) + '</option>';
            }).join('');

            var imageOptions = [
                { val: '',        label: '自动' },
                { val: 'Primary', label: '主图' },
                { val: 'Thumb',   label: '缩略图' }
            ].map(function (o) {
                return '<option value="' + escAttr(o.val) + '"' + (o.val === presetImageType ? ' selected' : '') + '>' + escHtml(o.label) + '</option>';
            }).join('');

            var titleText    = (isEdit ? '编辑手动' : '创建手动') + (isShows ? '剧集' : '') + '榜单';
            var createBtnLabel = isEdit ? '保存更改' : '创建榜单';

            var innerBox = modal.querySelector('div');
            innerBox.innerHTML =
                // ── Header ──────────────────────────────────────────────────
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">' +
                '<h3 style="margin:0;font-size:1.1em;color:#52B54B;">' + escHtml(titleText) + '</h3>' +
                '<button type="button" class="btnMtlClose" style="background:transparent;border:none;color:inherit;cursor:pointer;padding:2px;opacity:0.6;line-height:1;"><i class="md-icon">close</i></button>' +
                '</div>' +

                // ── Two columns ──────────────────────────────────────────────
                '<div style="display:flex;gap:0;align-items:stretch;">' +

                // LEFT column: home section settings
                '<div style="flex:1;min-width:0;padding-right:20px;border-right:1px solid var(--line-color);">' +
                '<div style="' + colHeaderStyle + '"><i class="md-icon" style="font-size:0.9em;vertical-align:middle;margin-right:5px;">home</i>主屏幕栏目设置</div>' +

                '<div style="' + fieldStyle + '">' +
                '<label style="' + labelStyle + '">列表名称</label>' +
                '<input type="text" class="mtlListName" style="' + inputStyle + '" placeholder="例如：我的收藏"' + (isEdit ? ' readonly style="' + inputStyle + 'opacity:0.6;cursor:not-allowed;"' : '') + ' value="' + escAttr(presetName) + '" /></div>' +

                '<div style="' + fieldStyle + '">' +
                '<label style="' + labelStyle + '">自定义标题 <span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:0.7;">（显示在主屏幕）</span></label>' +
                '<input type="text" class="mtlCustomName" style="' + inputStyle + '" placeholder="默认为列表名称" value="' + escAttr(presetCustomName) + '" /></div>' +

                '<div style="' + fieldStyle + '"><span style="' + labelStyle + '">目标用户</span>' +
                '<div>' + usersHtml + '</div></div>' +

                '<div style="' + fieldStyle + '">' +
                '<label style="' + labelStyle + '">显示此栏目</label>' +
                '<select is="emby-select" class="mtlDisplayMode" style="width:100%;">' + displayOptions + '</select></div>' +

                '<div style="' + fieldStyle + '">' +
                '<label style="' + labelStyle + '">图片类型</label>' +
                '<select is="emby-select" class="mtlImageType" style="width:100%;">' + imageOptions + '</select></div>' +

                '</div>' +

                // RIGHT column: movie list
                '<div style="flex:1;min-width:0;padding-left:20px;">' +
                '<div style="' + colHeaderStyle + '"><i class="md-icon" style="font-size:0.9em;vertical-align:middle;margin-right:5px;">format_list_numbered</i>' + (isShows ? '剧集列表' : '电影列表') + '</div>' +

                '<div style="' + fieldStyle + '">' +
                '<label style="' + labelStyle + '">' + (isShows ? '添加剧集' : '添加电影') + '</label>' +
                '<div style="position:relative;">' +
                '<input type="text" class="mtlMovieSearch" autocomplete="off" style="' + inputStyle + '" placeholder="输入以搜索…" />' +
                '<div class="mtlSearchResults" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:200;background:var(--plugin-popup-bg,#2a2a2a);border:1px solid var(--line-color);border-radius:4px;max-height:200px;overflow-y:auto;margin-top:2px;box-shadow:0 4px 12px rgba(0,0,0,0.45);"></div>' +
                '</div></div>' +

                '<div class="mtlSelectedList" style="max-height:500px;overflow-y:auto;border:1px solid var(--line-color);border-radius:4px;padding:4px 8px;min-height:60px;"></div>' +
                '</div>' +

                '</div>' +

                '<div style="border-top:1px solid var(--line-color);padding-top:14px;margin-top:4px;">' +
                buildBadgePickerHtml(presetBadgeStyle) +
                '</div>' +

                '<div class="mtl-error" style="color:#cc3333;font-size:0.85em;min-height:1.2em;margin-top:12px;margin-bottom:4px;"></div>' +
                '<div style="border-top:1px solid var(--line-color);padding-top:16px;margin-top:8px;display:flex;gap:10px;align-items:center;justify-content:flex-end;">' +
                '<button type="button" class="btnMtlCancel" style="cursor:pointer;border:1px solid var(--line-color);background:transparent;color:var(--theme-text-primary);border-radius:3px;padding:8px 18px;font-size:0.9em;">取消</button>' +
                '<button type="button" class="btnMtlCreate" disabled style="cursor:pointer;border:none;background:#52B54B;color:#fff;border-radius:4px;padding:10px 26px;font-size:0.95em;font-weight:600;display:flex;align-items:center;gap:6px;">' +
                '<i class="md-icon" style="font-size:1em;">playlist_add</i>' + escHtml(createBtnLabel) + '</button>' +
                '</div>';

            initBadgePicker(modal);
            wireUserMultiSelect(modal);

            // In edit mode, set list name field readonly again (the value= attr trick above may not
            // work if the readonly attr comes after a style attr — set it via JS to be safe)
            if (isEdit) {
                var nameInput = modal.querySelector('.mtlListName');
                nameInput.readOnly = true;
                nameInput.style.opacity = '0.6';
                nameInput.style.cursor  = 'not-allowed';
            }

            var selectedMovies = (existingData && existingData.movies) ? existingData.movies.slice() : [];

            function renderSelectedList() {
                var listEl = modal.querySelector('.mtlSelectedList');
                if (selectedMovies.length === 0) {
                    listEl.innerHTML = '<div style="padding:8px 4px;opacity:0.5;font-size:0.9em;">尚未添加' + itemWord + '。</div>'; 
                    return;
                }
                listEl.innerHTML = selectedMovies.map(function (m, idx) {
                    var label = escHtml(m.Name) + (m.Year ? ' (' + escHtml(String(m.Year)) + ')' : '');
                    var upDis  = idx === 0 ? ' disabled' : '';
                    var dnDis  = idx === selectedMovies.length - 1 ? ' disabled' : '';
                    return '<div style="display:flex;align-items:center;gap:5px;padding:5px 2px;border-bottom:1px solid rgba(128,128,128,0.15);">' +
                        '<span style="min-width:22px;font-size:0.8em;opacity:0.55;font-weight:600;text-align:right;">' + (idx + 1) + '.</span>' +
                        '<span style="flex:1;font-size:0.88em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escAttr(m.Name) + '">' + label + '</span>' +
                        '<button type="button" class="btnMtlUp" data-idx="' + idx + '"' + upDis + ' style="cursor:pointer;border:none;background:transparent;color:inherit;padding:2px 4px;opacity:0.7;font-size:0.9em;line-height:1;" title="上移">▲</button>' +
                        '<button type="button" class="btnMtlDown" data-idx="' + idx + '"' + dnDis + ' style="cursor:pointer;border:none;background:transparent;color:inherit;padding:2px 4px;opacity:0.7;font-size:0.9em;line-height:1;" title="下移">▼</button>' +
                        '<button type="button" class="btnMtlRemove" data-idx="' + idx + '" style="cursor:pointer;border:none;background:transparent;color:#cc3333;padding:2px 4px;font-size:0.9em;line-height:1;" title="移除">✕</button>' +
                        '</div>';
                }).join('');
            }

            function updateCreateBtn() {
                var nameVal  = (modal.querySelector('.mtlListName').value || '').trim();
                var hasUsers = modal.querySelectorAll('.chkMtlUser:checked').length > 0;
                modal.querySelector('.btnMtlCreate').disabled = (nameVal.length === 0 || selectedMovies.length === 0 || !hasUsers);
            }

            renderSelectedList();
            updateCreateBtn();

            modal.querySelector('.btnMtlClose').addEventListener('click', function () { modal.remove(); document.removeEventListener('keydown', onEsc); });
            modal.querySelector('.btnMtlCancel').addEventListener('click', function () { modal.remove(); document.removeEventListener('keydown', onEsc); });

            modal.querySelector('.mtlListName').addEventListener('input', updateCreateBtn);

            modal.querySelectorAll('.chkMtlUser').forEach(function (cb) {
                cb.addEventListener('change', updateCreateBtn);
            });

            var searchInput  = modal.querySelector('.mtlMovieSearch');
            var resultsBox   = modal.querySelector('.mtlSearchResults');

            function showSearchResults(q) {
                q = (q || '').trim().toLowerCase();
                if (q.length < 1) { resultsBox.style.display = 'none'; resultsBox.innerHTML = ''; return; }
                var hits = allMovies.filter(function (m) {
                    return m.Name.toLowerCase().indexOf(q) !== -1 ||
                           (m.Year && String(m.Year).indexOf(q) !== -1);
                }).slice(0, 20);
                if (hits.length === 0) { resultsBox.style.display = 'none'; return; }
                var alreadyIds = new Set(selectedMovies.map(function (m) { return m.ItemId; }));
                resultsBox.innerHTML = hits.map(function (m) {
                    var added = alreadyIds.has(m.ItemId);
                    var label = escHtml(m.Name) + (m.Year ? ' (' + m.Year + ')' : '');
                    return '<div class="mtlSearchResult" data-itemid="' + escAttr(m.ItemId) + '"' +
                        ' data-imdbid="' + escAttr(m.ImdbId) + '"' +
                        ' data-name="' + escAttr(m.Name) + '"' +
                        ' data-year="' + escAttr(String(m.Year || '')) + '"' +
                        ' style="padding:7px 12px;cursor:pointer;font-size:0.9em;border-bottom:1px solid rgba(128,128,128,0.12);' +
                        (added ? 'opacity:0.42;pointer-events:none;' : '') + '">' +
                        label + (added ? ' <span style="font-size:0.8em;">（已添加）</span>' : '') + '</div>'; 
                }).join('');
                resultsBox.style.display = 'block';
            }

            searchInput.addEventListener('input', function () { showSearchResults(this.value); });
            searchInput.addEventListener('focus',  function () { showSearchResults(this.value); });

            resultsBox.addEventListener('mousedown', function (e) {
                // mousedown fires before blur so we can intercept before the field loses focus
                var row = e.target.closest('.mtlSearchResult');
                if (!row || !row.dataset.itemid) return;
                e.preventDefault(); // keep focus on searchInput
                if (selectedMovies.some(function (m) { return m.ItemId === row.dataset.itemid; })) return;
                selectedMovies.push({
                    ItemId: row.dataset.itemid,
                    ImdbId: row.dataset.imdbid || '',
                    Name:   row.dataset.name   || '',
                    Year:   row.dataset.year   ? parseInt(row.dataset.year, 10) : null
                });
                searchInput.value = '';
                resultsBox.style.display = 'none';
                renderSelectedList();
                updateCreateBtn();
            });

            searchInput.addEventListener('blur', function () {
                setTimeout(function () { resultsBox.style.display = 'none'; }, 150);
            });

            modal.querySelector('.mtlSelectedList').addEventListener('click', function (e) {
                var btn = e.target.closest('button');
                if (!btn) return;
                var idx = parseInt(btn.dataset.idx, 10);
                if (isNaN(idx)) return;
                var tmp;
                if (btn.classList.contains('btnMtlUp') && idx > 0) {
                    tmp = selectedMovies[idx - 1];
                    selectedMovies[idx - 1] = selectedMovies[idx];
                    selectedMovies[idx] = tmp;
                } else if (btn.classList.contains('btnMtlDown') && idx < selectedMovies.length - 1) {
                    tmp = selectedMovies[idx + 1];
                    selectedMovies[idx + 1] = selectedMovies[idx];
                    selectedMovies[idx] = tmp;
                } else if (btn.classList.contains('btnMtlRemove')) {
                    selectedMovies.splice(idx, 1);
                }
                renderSelectedList();
                updateCreateBtn();
            });

            modal.querySelector('.btnMtlCreate').addEventListener('click', function () {
                var createBtn  = this;
                var errEl      = modal.querySelector('.mtl-error');
                errEl.textContent = '';

                var listName        = (modal.querySelector('.mtlListName').value || '').trim();
                var customNameVal   = (modal.querySelector('.mtlCustomName').value || '').trim() || listName;
                var displayMode     = modal.querySelector('.mtlDisplayMode').value;
                var imageType       = modal.querySelector('.mtlImageType').value;
                var badgeStyle      = readBadgeStyle(modal);
                var selectedUserIds = Array.from(modal.querySelectorAll('.chkMtlUser:checked')).map(function (c) { return c.value; });

                if (!listName)                    { errEl.textContent = '请输入列表名称。'; return; }
                if (selectedUserIds.length === 0) { errEl.textContent = '请至少选择一位目标用户。'; return; }
                if (selectedMovies.length === 0)  { errEl.textContent = '请至少添加一部' + itemWord + '。'; return; }

                createBtn.disabled = true;
                createBtn.innerHTML = '正在准备文件 <span class="tc-dot-loader"><span></span><span></span><span></span></span>'; 

                var tok2 = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
                fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/PrepareManualFolder'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok2 },
                    body: JSON.stringify({
                        ListName: listName,
                        BadgeStyle: badgeStyle,
                        ContentType: isShows ? 'Shows' : 'Movies',
                        Items: selectedMovies.map(function (m) { return { ImdbId: m.ImdbId, ItemId: m.ItemId }; })
                    })
                })
                .then(function (r) { return r.json(); })
                .then(function (prepareResult) {
                    if (!prepareResult.Success) throw new Error(prepareResult.Message || '创建文件夹失败。');
                    if (isShows && !prepareResult.FilesCreated) throw new Error('所选剧集均不包含单集文件。');
                    executeTopListCreationSteps(
                        listName, customNameVal, selectedUserIds, displayMode, customNameVal, imageType, 0,
                        prepareResult, { saveBtn: createBtn, errEl: errEl, modal: modal, badgeStyle: badgeStyle, contentType: isShows ? 'Shows' : 'Movies' }, function () {
                            document.removeEventListener('keydown', onEsc);
                            if (typeof onSuccess === 'function') onSuccess();
                        }
                    );
                })
                .catch(function (err) {
                    createBtn.disabled = false;
                    createBtn.innerHTML = '<i class="md-icon" style="font-size:1em;">playlist_add</i>' + escHtml(createBtnLabel);
                    errEl.textContent = err.message || String(err);
                });
            });
        })
        .catch(function (err) {
            var innerBox = modal.querySelector('div');
            innerBox.innerHTML =
                '<div style="color:#cc3333;padding:10px 0;">加载失败：' + escapeHtml(err.message || String(err)) + '</div>' +
                '<div style="margin-top:16px;text-align:right;">' +
                '<button type="button" class="btnMtlClose" style="cursor:pointer;border:1px solid var(--line-color);background:transparent;color:inherit;border-radius:3px;padding:6px 14px;font-size:0.9em;">关闭</button>' +
                '</div>';
            modal.querySelector('.btnMtlClose').addEventListener('click', function () { modal.remove(); document.removeEventListener('keydown', onEsc); });
        });
    }

    function loadInlineEditForm(row, body, onSuccess) {
        var editJson;
        try { editJson = JSON.parse(row.dataset.editjson || '{}'); } catch (e) { editJson = {}; }

        var tagName     = editJson.tagName     || '';
        var isManual    = !!editJson.isManual;
        var displayName = editJson.displayName || editJson.customName || tagName;
        var isShows     = editJson.contentType === 'Shows';
        var contentType = isShows ? 'Shows' : 'Movies';
        var itemWord    = isShows ? '剧集' : '电影';

        function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
        function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

        var inputStyle = 'background:var(--plugin-input-bg);border:1px solid var(--plugin-input-border);border-radius:4px;padding:6px 10px;font-size:0.9em;color:var(--plugin-popup-color);width:100%;box-sizing:border-box;';
        var labelStyle = 'font-size:0.82em;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;opacity:0.65;display:block;margin-bottom:5px;';
        var fieldStyle = 'margin-bottom:14px;';

        var deleteHtml = '<button type="button" is="emby-button" class="raised btnTlDelete" data-name="' + escAttr(tagName) + '" style="background:#cc3333 !important;color:#fff;"><i class="md-icon" style="margin-right:5px;">delete</i>删除榜单</button>';

        body.innerHTML = '<div style="padding:8px 0;opacity:0.6;font-size:0.9em;">加载中… <span class="tc-dot-loader"><span></span><span></span><span></span></span></div>';

        var tok = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';

        if (isManual) {
            Promise.all([
                fetch(window.ApiClient.getUrl(isShows ? 'HomeScreenCompanionAnime/TopList/AllSeries' : 'HomeScreenCompanionAnime/TopList/AllMovies'), {
                    headers: { 'X-MediaBrowser-Token': tok }
                }).then(function (r) { return r.json(); }),
                getHseUsers(),
                fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/ManualItems') + '?ListName=' + encodeURIComponent(tagName), {
                    headers: { 'X-MediaBrowser-Token': tok }
                }).then(function (r) { return r.json(); })
            ]).then(function (res) {
                var allMovies = res[0].Movies || [];
                var users     = res[1];
                var data      = res[2];

                if (!data.Success) {
                    body.innerHTML = '<div style="color:#cc3333;padding:8px 0;">加载失败：' + escHtml(data.Message || '未知错误') + '</div>';
                    return;
                }

                var presetUserIds    = data.UserIds      || editJson.userIds      || [];
                var presetDisplay    = data.DisplayMode  || editJson.displayMode  || '';
                var presetImageType  = data.ImageType    || editJson.imageType    || '';
                var presetBadgeStyle = data.BadgeStyle   || editJson.badgeStyle   || 'neutral';
                var presetCustomName = data.CustomName   || editJson.customName   || '';
                var presetMovies     = data.Movies       || [];

                var colHeaderStyle = 'font-size:0.75em;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#52B54B;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid rgba(82,181,75,0.3);';

                var usersHtml = buildUserMultiSelectHtml(users, presetUserIds, 'chkMtlUser');

                var displayOptions = [
                    { val: '',               label: '始终' },
                    { val: 'tv',             label: '电视模式开启时' },
                    { val: 'mobile,desktop', label: '电视模式关闭时' }
                ].map(function (o) {
                    return '<option value="' + escAttr(o.val) + '"' + (o.val === presetDisplay ? ' selected' : '') + '>' + escHtml(o.label) + '</option>';
                }).join('');

                var imageOptions = [
                    { val: '',        label: '自动' },
                    { val: 'Primary', label: '主图' },
                    { val: 'Thumb',   label: '缩略图' }
                ].map(function (o) {
                    return '<option value="' + escAttr(o.val) + '"' + (o.val === presetImageType ? ' selected' : '') + '>' + escHtml(o.label) + '</option>';
                }).join('');

                var wrapper = document.createElement('div');
                wrapper.innerHTML =
                    '<div style="display:flex;gap:0;align-items:stretch;">' +

                    '<div style="flex:1;min-width:0;padding-right:20px;border-right:1px solid var(--line-color);">' +
                    '<div style="' + colHeaderStyle + '"><i class="md-icon" style="font-size:0.9em;vertical-align:middle;margin-right:5px;">home</i>主屏幕栏目设置</div>' +

                    '<div style="' + fieldStyle + '">' +
                    '<label style="' + labelStyle + '">自定义标题 <span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:0.7;">（显示在主屏幕）</span></label>' +
                    '<input type="text" class="mtlCustomName" style="' + inputStyle + '" placeholder="默认为榜单名称" value="' + escAttr(presetCustomName) + '" /></div>' +

                    '<div style="' + fieldStyle + '"><span style="' + labelStyle + '">目标用户</span>' +
                    '<div>' + usersHtml + '</div></div>' +

                    '<div style="' + fieldStyle + '">' +
                    '<label style="' + labelStyle + '">显示此栏目</label>' +
                    '<select is="emby-select" class="mtlDisplayMode" style="width:100%;">' + displayOptions + '</select></div>' +

                    '<div style="' + fieldStyle + '">' +
                    '<label style="' + labelStyle + '">图片类型</label>' +
                    '<select is="emby-select" class="mtlImageType" style="width:100%;">' + imageOptions + '</select></div>' +

                    '</div>' +

                    '<div style="flex:1;min-width:0;padding-left:20px;">' +
                    '<div style="' + colHeaderStyle + '"><i class="md-icon" style="font-size:0.9em;vertical-align:middle;margin-right:5px;">format_list_numbered</i>' + (isShows ? '剧集列表' : '电影列表') + '</div>' +

                    '<div style="' + fieldStyle + '">' +
                    '<label style="' + labelStyle + '">' + (isShows ? '添加剧集' : '添加电影') + '</label>' +
                    '<div style="position:relative;">' +
                    '<input type="text" class="mtlMovieSearch" autocomplete="off" style="' + inputStyle + '" placeholder="输入以搜索…" />' +
                    '<div class="mtlSearchResults" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:200;background:var(--plugin-popup-bg,#2a2a2a);border:1px solid var(--line-color);border-radius:4px;max-height:200px;overflow-y:auto;margin-top:2px;box-shadow:0 4px 12px rgba(0,0,0,0.45);"></div>' +
                    '</div></div>' +

                    '<div class="mtlSelectedList" style="max-height:280px;overflow-y:auto;border:1px solid var(--line-color);border-radius:4px;padding:4px 8px;min-height:60px;"></div>' +
                    '</div>' +

                    '</div>' +

                    '<div style="border-top:1px solid var(--line-color);padding-top:14px;margin-top:4px;">' +
                    buildBadgePickerHtml(presetBadgeStyle) +
                    '</div>' +

                    '<div class="mtl-error" style="color:#cc3333;font-size:0.85em;min-height:1.2em;margin-top:12px;margin-bottom:4px;"></div>' +
                    '<div style="border-top:1px solid var(--line-color);padding-top:16px;margin-top:8px;display:flex;gap:10px;align-items:center;justify-content:flex-end;">' +
                    deleteHtml +
                    '</div>';

                body.innerHTML = '';
                body.appendChild(wrapper);
                initBadgePicker(body);
                wireUserMultiSelect(wrapper);

                var selectedMovies = presetMovies.slice();
                var originalManualState;

                function renderSelectedList() {
                    var listEl = wrapper.querySelector('.mtlSelectedList');
                    if (selectedMovies.length === 0) {
                        listEl.innerHTML = '<div style="padding:8px 4px;opacity:0.5;font-size:0.9em;">尚未添加' + itemWord + '。</div>';
                        updateManualDirty();
                        return;
                    }
                    listEl.innerHTML = selectedMovies.map(function (m, idx) {
                        var label = escHtml(m.Name) + (m.Year ? ' (' + escHtml(String(m.Year)) + ')' : '');
                        var upDis = idx === 0 ? ' disabled' : '';
                        var dnDis = idx === selectedMovies.length - 1 ? ' disabled' : '';
                        return '<div style="display:flex;align-items:center;gap:5px;padding:5px 2px;border-bottom:1px solid rgba(128,128,128,0.15);">' +
                            '<span style="min-width:22px;font-size:0.8em;opacity:0.55;font-weight:600;text-align:right;">' + (idx + 1) + '.</span>' +
                            '<span style="flex:1;font-size:0.88em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escAttr(m.Name) + '">' + label + '</span>' +
                            '<button type="button" class="btnMtlUp" data-idx="' + idx + '"' + upDis + ' style="cursor:pointer;border:none;background:transparent;color:inherit;padding:2px 4px;opacity:0.7;font-size:0.9em;line-height:1;" title="上移">▲</button>' +
                            '<button type="button" class="btnMtlDown" data-idx="' + idx + '"' + dnDis + ' style="cursor:pointer;border:none;background:transparent;color:inherit;padding:2px 4px;opacity:0.7;font-size:0.9em;line-height:1;" title="下移">▼</button>' +
                            '<button type="button" class="btnMtlRemove" data-idx="' + idx + '" style="cursor:pointer;border:none;background:transparent;color:#cc3333;padding:2px 4px;font-size:0.9em;line-height:1;" title="移除">✕</button>' +
                            '</div>';
                    }).join('');
                    updateManualDirty();
                }

                renderSelectedList();
                originalManualState = getManualFormState();

                var searchInput = wrapper.querySelector('.mtlMovieSearch');
                var resultsBox  = wrapper.querySelector('.mtlSearchResults');

                function showSearchResults(q) {
                    q = (q || '').trim().toLowerCase();
                    if (q.length < 1) { resultsBox.style.display = 'none'; resultsBox.innerHTML = ''; return; }
                    var alreadyIds = new Set(selectedMovies.map(function (m) { return m.ItemId; }));
                    var hits = allMovies.filter(function (m) {
                        return m.Name.toLowerCase().indexOf(q) !== -1 || (m.Year && String(m.Year).indexOf(q) !== -1);
                    }).slice(0, 20);
                    if (hits.length === 0) { resultsBox.style.display = 'none'; return; }
                    resultsBox.innerHTML = hits.map(function (m) {
                        var added = alreadyIds.has(m.ItemId);
                        var lbl = escHtml(m.Name) + (m.Year ? ' (' + m.Year + ')' : '');
                        return '<div class="mtlSearchResult" data-itemid="' + escAttr(m.ItemId) + '" data-imdbid="' + escAttr(m.ImdbId) + '" data-name="' + escAttr(m.Name) + '" data-year="' + escAttr(String(m.Year || '')) + '" style="padding:7px 12px;cursor:pointer;font-size:0.9em;border-bottom:1px solid rgba(128,128,128,0.12);' + (added ? 'opacity:0.42;pointer-events:none;' : '') + '">' + lbl + (added ? ' <span style="font-size:0.8em;">（已添加）</span>' : '') + '</div>';
                    }).join('');
                    resultsBox.style.display = 'block';
                }

                searchInput.addEventListener('input', function () { showSearchResults(this.value); });
                searchInput.addEventListener('focus', function () { showSearchResults(this.value); });
                searchInput.addEventListener('blur',  function () { setTimeout(function () { resultsBox.style.display = 'none'; }, 150); });

                resultsBox.addEventListener('mousedown', function (e) {
                    var resultRow = e.target.closest('.mtlSearchResult');
                    if (!resultRow || !resultRow.dataset.itemid) return;
                    e.preventDefault();
                    if (selectedMovies.some(function (m) { return m.ItemId === resultRow.dataset.itemid; })) return;
                    selectedMovies.push({
                        ItemId: resultRow.dataset.itemid,
                        ImdbId: resultRow.dataset.imdbid || '',
                        Name:   resultRow.dataset.name   || '',
                        Year:   resultRow.dataset.year   ? parseInt(resultRow.dataset.year, 10) : null
                    });
                    searchInput.value = '';
                    resultsBox.style.display = 'none';
                    renderSelectedList();
                });

                wrapper.querySelector('.mtlSelectedList').addEventListener('click', function (e) {
                    var btn = e.target.closest('button');
                    if (!btn) return;
                    var idx = parseInt(btn.dataset.idx, 10);
                    if (isNaN(idx)) return;
                    var tmp;
                    if (btn.classList.contains('btnMtlUp') && idx > 0) {
                        tmp = selectedMovies[idx - 1]; selectedMovies[idx - 1] = selectedMovies[idx]; selectedMovies[idx] = tmp;
                    } else if (btn.classList.contains('btnMtlDown') && idx < selectedMovies.length - 1) {
                        tmp = selectedMovies[idx + 1]; selectedMovies[idx + 1] = selectedMovies[idx]; selectedMovies[idx] = tmp;
                    } else if (btn.classList.contains('btnMtlRemove')) {
                        selectedMovies.splice(idx, 1);
                    }
                    renderSelectedList();
                });

                function getManualFormState() {
                    return JSON.stringify({
                        customName: (wrapper.querySelector('.mtlCustomName').value || '').trim(),
                        displayMode: wrapper.querySelector('.mtlDisplayMode').value,
                        imageType: wrapper.querySelector('.mtlImageType').value,
                        badgeStyle: readBadgeStyle(body),
                        userIds: Array.from(wrapper.querySelectorAll('.chkMtlUser:checked')).map(function (c) { return c.value; }).sort(),
                        movies: selectedMovies.map(function (m) { return m.ItemId; })
                    });
                }
                function updateManualDirty() {
                    if (!originalManualState) return;
                    body.dataset.dirty = getManualFormState() !== originalManualState ? '1' : '0';
                    checkFormState();
                }
                wrapper.querySelectorAll('input, select').forEach(function (el) {
                    el.addEventListener('change', updateManualDirty);
                });
                wrapper.querySelectorAll('input[type="text"], input[type="number"]').forEach(function (el) {
                    el.addEventListener('input', updateManualDirty);
                });

                body.tlSaveForm = function () {
                    return new Promise(function (resolve, reject) {
                        var customNameVal   = (wrapper.querySelector('.mtlCustomName').value || '').trim() || tagName;
                        var displayMode     = wrapper.querySelector('.mtlDisplayMode').value;
                        var imageType       = wrapper.querySelector('.mtlImageType').value;
                        var badgeStyle      = readBadgeStyle(body);
                        var userIds         = Array.from(wrapper.querySelectorAll('.chkMtlUser:checked')).map(function (c) { return c.value; });

                        if (userIds.length === 0)      { reject(new Error('请至少选择一位目标用户。')); return; }
                        if (selectedMovies.length === 0) { reject(new Error('请至少添加一部' + itemWord + '。')); return; }

                        var tok2 = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
                        fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/PrepareManualFolder'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok2 },
                            body: JSON.stringify({
                                ListName: tagName, BadgeStyle: badgeStyle, ContentType: contentType,
                                Items: selectedMovies.map(function (m) { return { ImdbId: m.ImdbId, ItemId: m.ItemId }; })
                            })
                        })
                        .then(function (r) { return r.json(); })
                        .then(function (prepareResult) {
                            if (!prepareResult.Success) throw new Error(prepareResult.Message || '准备文件夹失败。');
                            var fakeBtn = { disabled: false, innerHTML: '' };
                            var errEl = wrapper.querySelector('.mtl-error');
                            executeTopListCreationSteps(
                                tagName, customNameVal, userIds, displayMode, customNameVal, imageType, 0,
                                prepareResult, { saveBtn: fakeBtn, errEl: errEl, modal: body, innerBox: wrapper, badgeStyle: badgeStyle, closeHandler: resolve, silent: true, contentType: contentType },
                                resolve
                            );
                        })
                        .catch(reject);
                    });
                };

            }).catch(function (err) {
                body.innerHTML = '<div style="color:#cc3333;padding:8px 0;">加载失败：' + escHtml(err.message || String(err)) + '</div>';
            });

        } else {
            getHseUsers().then(function (users) {
                var presetUserIds    = editJson.userIds     || [];
                var presetDisplay    = editJson.displayMode || '';
                var presetImageType  = editJson.imageType   || '';
                var presetBadgeStyle = editJson.badgeStyle  || 'neutral';
                var presetCustomName = editJson.customName  || '';
                var presetMaxItems   = editJson.maxItems    || '0';

                var usersHtml = buildUserMultiSelectHtml(users, presetUserIds, 'chkTlmUser');

                var wrapper = document.createElement('div');
                wrapper.innerHTML =
                    '<div style="' + fieldStyle + '">' +
                    '<span style="' + labelStyle + '">目标用户</span>' +
                    '<div>' + usersHtml + '</div>' +
                    '</div>' +

                    '<div style="' + fieldStyle + '">' +
                    '<label style="' + labelStyle + '">显示此栏目</label>' +
                    '<select is="emby-select" class="tlm-display-mode" style="width:100%;">' +
                    '<option value="">始终</option>' +
                    '<option value="tv">电视模式开启时</option>' +
                    '<option value="mobile,desktop">电视模式关闭时</option>' +
                    '</select></div>' +

                    '<div style="' + fieldStyle + '">' +
                    '<label style="' + labelStyle + '">自定义标题</label>' +
                    '<input type="text" class="tlm-custom-name" style="' + inputStyle + '" placeholder="' + escAttr(displayName) + '" />' +
                    '</div>' +

                    '<div style="' + fieldStyle + '">' +
                    '<label style="' + labelStyle + '">图片类型</label>' +
                    '<select is="emby-select" class="tlm-image-type" style="width:100%;">' +
                    '<option value="">自动</option>' +
                    '<option value="Primary">主图</option>' +
                    '<option value="Thumb">缩略图</option>' +
                    '</select></div>' +

                    buildBadgePickerHtml(presetBadgeStyle) +

                    '<div style="' + fieldStyle + '">' +
                    '<label style="' + labelStyle + '">最大项目数 <span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:0.7;">（0 = 全部）</span></label>' +
                    '<input type="number" class="tlm-max-items" min="0" step="1" style="' + inputStyle + '" placeholder="0" />' +
                    '</div>' +

                    '<div class="tlm-error" style="color:#cc3333;font-size:0.85em;min-height:1.2em;margin-bottom:4px;"></div>' +
                    '<div style="border-top:1px solid var(--line-color);padding-top:16px;display:flex;gap:10px;align-items:center;justify-content:flex-end;">' +
                    deleteHtml +
                    '</div>';

                body.innerHTML = '';
                body.appendChild(wrapper);
                initBadgePicker(body);
                wireUserMultiSelect(wrapper);

                if (presetCustomName) wrapper.querySelector('.tlm-custom-name').value = presetCustomName;
                if (presetDisplay)    wrapper.querySelector('.tlm-display-mode').value = presetDisplay;
                if (presetImageType)  wrapper.querySelector('.tlm-image-type').value = presetImageType;
                if (presetMaxItems && presetMaxItems !== '0') wrapper.querySelector('.tlm-max-items').value = presetMaxItems;

                function getRegularFormState() {
                    return JSON.stringify({
                        customName: (wrapper.querySelector('.tlm-custom-name').value || '').trim(),
                        displayMode: wrapper.querySelector('.tlm-display-mode').value,
                        imageType: wrapper.querySelector('.tlm-image-type').value,
                        badgeStyle: readBadgeStyle(body),
                        maxItems: wrapper.querySelector('.tlm-max-items').value,
                        userIds: Array.from(wrapper.querySelectorAll('.chkTlmUser:checked')).map(function (c) { return c.value; }).sort()
                    });
                }
                var originalRegularState = getRegularFormState();
                function updateRegularDirty() {
                    body.dataset.dirty = getRegularFormState() !== originalRegularState ? '1' : '0';
                    checkFormState();
                }
                wrapper.querySelectorAll('input, select').forEach(function (el) {
                    el.addEventListener('change', updateRegularDirty);
                });
                wrapper.querySelectorAll('input[type="text"], input[type="number"]').forEach(function (el) {
                    el.addEventListener('input', updateRegularDirty);
                });

                body.tlSaveForm = function () {
                    return new Promise(function (resolve, reject) {
                        var userIds       = Array.from(wrapper.querySelectorAll('.chkTlmUser:checked')).map(function (c) { return c.value; });
                        if (userIds.length === 0) { reject(new Error('请至少选择一位目标用户。')); return; }

                        var customNameVal = wrapper.querySelector('.tlm-custom-name').value.trim() || displayName;
                        var displayMode   = wrapper.querySelector('.tlm-display-mode').value;
                        var imageType     = wrapper.querySelector('.tlm-image-type').value;
                        var badgeStyle    = readBadgeStyle(body);
                        var maxItems      = Math.max(0, parseInt(wrapper.querySelector('.tlm-max-items').value, 10) || 0);
                        var tok2 = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';

                        fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/PrepareFolder'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok2 },
                            body: JSON.stringify({ TagName: tagName, MaxItems: maxItems, BadgeStyle: badgeStyle, ContentType: contentType })
                        })
                        .then(function (r) { return r.json(); })
                        .then(function (prepareResult) {
                            if (!prepareResult.Success) throw new Error(prepareResult.Message || '准备文件夹失败。');
                            var fakeBtn = { disabled: false, innerHTML: '' };
                            var errEl = wrapper.querySelector('.tlm-error');
                            executeTopListCreationSteps(
                                tagName, customNameVal, userIds, displayMode, customNameVal, imageType, maxItems,
                                prepareResult, { saveBtn: fakeBtn, errEl: errEl, modal: body, innerBox: wrapper, badgeStyle: badgeStyle, closeHandler: resolve, silent: true, contentType: contentType },
                                resolve
                            );
                        })
                        .catch(reject);
                    });
                };

            }).catch(function (err) {
                body.innerHTML = '<div style="color:#cc3333;padding:8px 0;">加载用户失败：' + escHtml(err.message || String(err)) + '</div>';
            });
        }
    }

    // existingTypes: sanitized list name (lower case) → 'Movies' | 'Shows'
    function showCreateTopListChooser(tagsData, existingTopLists, onSuccess, existingTypes) {
        existingTypes = existingTypes || {};
        function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
        function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        function sanitizeName(name) {
            var safe = (name || 'unknown').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').trim();
            return safe.length === 0 ? 'unknown' : safe;
        }

        var modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;';
        document.body.appendChild(modal);

        function onEsc(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onEsc); } }
        document.addEventListener('keydown', onEsc);
        modal.addEventListener('click', function (e) { if (e.target === modal) { modal.remove(); document.removeEventListener('keydown', onEsc); } });

        var innerStyle = 'background:var(--plugin-popup-bg,#2a2a2a);color:var(--plugin-popup-color,#e8e8e8);' +
            'border:1px solid var(--plugin-popup-border,rgba(255,255,255,0.12));border-radius:8px;' +
            'padding:28px;max-width:480px;width:90%;max-height:85vh;overflow-y:auto;';

        var contentType = 'Movies';

        function renderStep1() {
            var isShows = contentType === 'Shows';
            var segBase = 'flex:1;cursor:pointer;border:none;padding:8px 12px;font-size:0.9em;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;';
            var segOn  = segBase + 'background:#52B54B;color:#fff;';
            var segOff = segBase + 'background:transparent;color:inherit;opacity:0.75;';
            modal.innerHTML =
                '<div style="' + innerStyle + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
                '<h3 style="margin:0;font-size:1.1em;color:#52B54B;">创建榜单</h3>' +
                '<button type="button" class="btnChooserClose" style="background:transparent;border:none;color:inherit;cursor:pointer;padding:2px;opacity:0.6;line-height:1;"><i class="md-icon">close</i></button>' +
                '</div>' +
                '<div style="display:flex;border:1px solid var(--plugin-input-border,rgba(255,255,255,0.12));border-radius:6px;overflow:hidden;margin-bottom:20px;">' +
                '<button type="button" class="btnChooseType" data-type="Movies" style="' + (isShows ? segOff : segOn) + '"><i class="md-icon" style="font-size:1.1em;">movie</i>电影</button>' +
                '<button type="button" class="btnChooseType" data-type="Shows" style="' + (isShows ? segOn : segOff) + '"><i class="md-icon" style="font-size:1.1em;">tv</i>剧集</button>' +
                '</div>' +
                '<p style="margin:0 0 20px;font-size:0.9em;color:var(--theme-text-secondary);">您想如何创建此榜单？</p>' +
                '<div style="display:flex;gap:16px;">' +
                '<button type="button" class="btnChooseManual" style="flex:1;cursor:pointer;background:var(--plugin-input-bg,rgba(255,255,255,0.05));border:1px solid var(--plugin-input-border,rgba(255,255,255,0.12));border-radius:8px;padding:20px 16px;text-align:left;color:inherit;">' +
                '<div style="font-size:1.4em;margin-bottom:10px;color:#52B54B;"><i class="md-icon">format_list_numbered</i></div>' +
                '<div style="font-weight:600;font-size:0.95em;margin-bottom:6px;">手动</div>' +
                '<div style="font-size:0.82em;color:var(--theme-text-secondary);line-height:1.5;">手动选择' + (isShows ? '剧集' : '电影') + '，创建自定义榜单</div>' +
                '</button>' +
                '<button type="button" class="btnChooseByTag" style="flex:1;cursor:pointer;background:var(--plugin-input-bg,rgba(255,255,255,0.05));border:1px solid var(--plugin-input-border,rgba(255,255,255,0.12));border-radius:8px;padding:20px 16px;text-align:left;color:inherit;">' +
                '<div style="font-size:1.4em;margin-bottom:10px;color:#52B54B;"><i class="md-icon">label</i></div>' +
                '<div style="font-weight:600;font-size:0.95em;margin-bottom:6px;">按标签</div>' +
                '<div style="font-size:0.82em;color:var(--theme-text-secondary);line-height:1.5;">使用媒体库中的现有标签创建</div>' +
                '</button>' +
                '</div>' +
                '</div>';

            modal.querySelector('.btnChooserClose').addEventListener('click', function () { modal.remove(); document.removeEventListener('keydown', onEsc); });

            modal.querySelectorAll('.btnChooseType').forEach(function (btn) {
                btn.addEventListener('click', function () { contentType = this.dataset.type; renderStep1(); });
            });

            var btnManualCard = modal.querySelector('.btnChooseManual');
            var btnByTagCard  = modal.querySelector('.btnChooseByTag');

            [btnManualCard, btnByTagCard].forEach(function (btn) {
                btn.addEventListener('mouseover', function () { this.style.borderColor = '#52B54B'; });
                btn.addEventListener('mouseout',  function () { this.style.borderColor = 'var(--plugin-input-border,rgba(255,255,255,0.12))'; });
            });

            btnManualCard.addEventListener('click', function () {
                modal.remove();
                document.removeEventListener('keydown', onEsc);
                showManualTopListModal(onSuccess, null, contentType);
            });

            btnByTagCard.addEventListener('click', function () { renderStep2(); });
        }

        function renderStep2() {
            var isShows = contentType === 'Shows';
            // Show lists need a tag on shows (or their seasons/episodes).
            var tags = (tagsData.Tags || []).filter(function (t) { return !isShows || (t.SeriesCount || 0) > 0; });
            var inputStyle = 'background:var(--plugin-input-bg);border:1px solid var(--plugin-input-border);border-radius:4px;padding:6px 10px;font-size:0.9em;color:var(--plugin-popup-color);width:100%;box-sizing:border-box;';

            var tagRowsHtml = tags.length === 0
                ? '<p style="padding:12px 4px;color:var(--theme-text-secondary);font-size:0.88em;font-style:italic;">' + (isShows ? '未找到剧集标签。' : '未找到标签。') + '</p>'
                : tags.map(function (tag) {
                    var name  = tag.Name || '';
                    var count = isShows ? (tag.SeriesCount || 0)
                        : (tag.MovieCount != null ? tag.MovieCount : (tag.ItemCount != null ? tag.ItemCount : 0));
                    var hasTopList = existingTopLists.has(sanitizeName(name).toLowerCase());
                    var badge = hasTopList
                        ? '<span style="font-size:0.72em;background:rgba(180,140,50,0.18);color:#c9a84c;border-radius:3px;padding:1px 6px;margin-left:6px;white-space:nowrap;">榜单</span>'
                        : '';
                    return '<button type="button" class="btnSelectTag" data-name="' + escAttr(name) + '" ' +
                        'style="width:100%;cursor:pointer;background:transparent;border:none;border-bottom:1px solid var(--line-color);' +
                        'padding:10px 4px;display:flex;align-items:center;color:inherit;text-align:left;">' +
                        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(name) + badge + '</span>' +
                        '<span style="margin-left:12px;white-space:nowrap;font-size:0.85em;color:var(--theme-text-secondary);">' + count + (isShows ? ' 部剧集' : ' 部电影') + '</span>' +
                        '</button>';
                }).join('');

            modal.innerHTML =
                '<div style="' + innerStyle + 'max-width:520px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
                '<div style="display:flex;align-items:center;gap:10px;">' +
                '<button type="button" class="btnChooserBack" style="background:transparent;border:none;color:var(--theme-text-secondary);cursor:pointer;padding:2px;line-height:1;opacity:0.7;"><i class="md-icon">arrow_back</i></button>' +
                '<h3 style="margin:0;font-size:1.1em;color:#52B54B;">选择标签</h3>' +
                '</div>' +
                '<button type="button" class="btnChooserClose" style="background:transparent;border:none;color:inherit;cursor:pointer;padding:2px;opacity:0.6;line-height:1;"><i class="md-icon">close</i></button>' +
                '</div>' +
                '<div style="margin-bottom:14px;">' +
                '<input type="text" id="tlChooserSearch" placeholder="搜索标签…" style="' + inputStyle + '" />' +
                '</div>' +
                '<div id="tlChooserTagList" style="max-height:50vh;overflow-y:auto;">' +
                tagRowsHtml +
                '</div>' +
                '</div>';

            modal.querySelector('.btnChooserClose').addEventListener('click', function () { modal.remove(); document.removeEventListener('keydown', onEsc); });
            modal.querySelector('.btnChooserBack').addEventListener('click', function () { renderStep1(); });

            modal.querySelector('#tlChooserSearch').addEventListener('input', function () {
                var q = this.value.toLowerCase();
                modal.querySelectorAll('.btnSelectTag').forEach(function (btn) {
                    btn.style.display = (!q || (btn.dataset.name || '').toLowerCase().indexOf(q) !== -1) ? '' : 'none';
                });
            });

            modal.querySelectorAll('.btnSelectTag').forEach(function (btn) {
                btn.addEventListener('mouseover', function () { this.style.background = 'rgba(82,181,75,0.08)'; });
                btn.addEventListener('mouseout',  function () { this.style.background = 'transparent'; });
                btn.addEventListener('click', function () {
                    var tagName = this.dataset.name;
                    // One top-list per tag: its folder and settings are keyed by the tag name.
                    var otherType = existingTypes[sanitizeName(tagName).toLowerCase()];
                    if (otherType && otherType !== contentType) {
                        alert('此标签已有一个' + (otherType === 'Shows' ? '剧集' : '电影') + '榜单。每个标签只能有一个榜单，请先删除现有榜单，再创建' + (contentType === 'Shows' ? '剧集' : '电影') + '榜单。');
                        return;
                    }
                    modal.remove();
                    document.removeEventListener('keydown', onEsc);
                    showTopListModal(tagName, tagName, onSuccess, null, contentType);
                });
            });
        }

        renderStep1();
    }

    // ── Backup & Restore ─────────────────────────────────────────────────────────────
    // Sections mirror the server's BackupFile. Only configuration is exported; everything the
    // sync tasks generate (tags, collections, playlists, top-list files, images) is rebuilt on run.
    var _backupSections = [
        { key: 'Settings',     label: '常规设置',          desc: 'AI 模型、系统提示词、日志、仅预览、结果为空时保留；含动漫策略（启用、前缀、提醒跳过写入、建议开关、别名与成员规则）。' },
        { key: 'ApiKeys',      label: 'API 密钥',                  desc: 'Trakt、MDBList、TMDB、OpenAI、Gemini、Claude、OpenAI 兼容接口。以明文存储在文件中。' },
        { key: 'Tags',         label: '标签与合集分组',   desc: '所有来源分组，包括计划、黑名单、筛选器、合集设置、主屏幕栏目和播放列表。' },
        { key: 'SavedFilters', label: '已保存的媒体信息筛选器',  desc: '您保存的筛选预设。' },
        { key: 'TopLists',     label: '榜单',                 desc: '榜单设置，以及手动榜单中的电影和剧集列表。' },
        { key: 'HomeSync',     label: '主屏幕同步',          desc: '来源用户、目标用户、媒体库顺序同步以及“继续观看”置顶。' },
        { key: 'AnimeReminders', label: '动漫提醒状态',     desc: '上次同步留下的提醒与已处理标记。不含合集本身，合集由下次同步重建。' }
    ];

    function buildBackupModalShell() {
        var modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;';
        modal.renderBox = function (content) {
            modal.innerHTML =
                '<div style="background:var(--plugin-popup-bg,#2a2a2a);color:var(--plugin-popup-color,#e8e8e8);' +
                'border:1px solid var(--plugin-popup-border,rgba(255,255,255,0.12));border-radius:8px;' +
                'padding:28px;max-width:560px;width:90%;max-height:85vh;overflow-y:auto;">' +
                content + '</div>';
        };
        function onEsc(e) { if (e.key === 'Escape') modal.close(); }
        modal.close = function () { modal.remove(); document.removeEventListener('keydown', onEsc); };
        document.addEventListener('keydown', onEsc);
        modal.addEventListener('click', function (e) { if (e.target === modal && !modal.dataset.busy) modal.close(); });
        document.body.appendChild(modal);
        return modal;
    }

    // available: null = every section selectable; otherwise a Set of section keys present in the file
    function buildBackupSectionsHtml(available, chkClass) {
        return _backupSections.map(function (s) {
            var present = !available || available.has(s.key);
            var rowStyle = 'display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-color,rgba(255,255,255,0.08));' + (present ? '' : 'opacity:0.45;');
            return '<label style="' + rowStyle + 'cursor:' + (present ? 'pointer' : 'default') + ';">' +
                '<input type="checkbox" class="' + chkClass + '" data-section="' + s.key + '"' + (present ? ' checked' : ' disabled') + ' style="margin-top:3px;" />' +
                '<span style="flex:1;">' +
                '<span style="display:block;font-weight:600;font-size:0.95em;">' + s.label + (present ? '' : ' <span style="font-weight:400;opacity:0.7;">（文件中不包含）</span>') + '</span>' +
                '<span style="display:block;font-size:0.82em;opacity:0.65;margin-top:2px;">' + s.desc + '</span>' +
                '</span></label>';
        }).join('');
    }

    function readBackupSectionFlags(modal, chkClass) {
        var flags = {};
        modal.querySelectorAll('.' + chkClass).forEach(function (c) { flags[c.dataset.section] = !c.disabled && c.checked; });
        return flags;
    }

    var _backupBtnPrimary = 'cursor:pointer;border:none;background:#52B54B;color:#fff;border-radius:4px;padding:10px 26px;font-size:0.95em;font-weight:600;';
    var _backupBtnSecondary = 'cursor:pointer;border:1px solid var(--line-color);background:transparent;color:var(--theme-text-primary);border-radius:3px;padding:8px 18px;font-size:0.9em;';
    var _backupTitleStyle = 'margin:0 0 6px;font-size:1.15em;font-weight:600;';
    var _backupHintStyle = 'font-size:0.88em;opacity:0.7;margin:0 0 14px;line-height:1.45;';

    function showBackupModal() {
        var modal = buildBackupModalShell();
        modal.renderBox(
            '<h3 style="' + _backupTitleStyle + '">下载备份</h3>' +
            '<p style="' + _backupHintStyle + '">选择要包含的内容。仅保存配置，标签、合集、播放列表、榜单文件和图片将由插件在下次同步时重新创建。</p>' +
            '<div style="margin-bottom:16px;">' + buildBackupSectionsHtml(null, 'chkBackupSection') + '</div>' +
            '<div class="backup-error" style="color:#cc3333;font-size:0.85em;min-height:1.2em;margin-bottom:6px;"></div>' +
            '<div style="display:flex;gap:10px;justify-content:flex-end;align-items:center;">' +
            '<button type="button" class="btnBackupCancel" style="' + _backupBtnSecondary + '">取消</button>' +
            '<button type="button" class="btnBackupDownload" style="' + _backupBtnPrimary + '"><i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:6px;">download</i>下载</button>' +
            '</div>'
        );
        modal.querySelector('.btnBackupCancel').addEventListener('click', modal.close);
        modal.querySelector('.btnBackupDownload').addEventListener('click', function () {
            var btn = this;
            var errEl = modal.querySelector('.backup-error');
            var flags = readBackupSectionFlags(modal, 'chkBackupSection');
            if (!Object.keys(flags).some(function (k) { return flags[k]; })) { errEl.textContent = '请至少选择一项。'; return; }
            errEl.textContent = '';
            btn.disabled = true;
            btn.innerHTML = '正在准备 <span class="tc-dot-loader"><span></span><span></span><span></span></span>';
            modal.dataset.busy = '1';
            var tok = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Backup/Export'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok },
                body: JSON.stringify(flags)
            })
            .then(function (r) { if (!r.ok) throw new Error('服务器返回 ' + r.status); return r.json(); })
            .then(function (backup) {
                var json = JSON.stringify(backup, null, 2);
                var blob = new Blob([json], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = 'HSC_Backup_' + new Date().toISOString().split('T')[0] + '.json';
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                modal.close();
            })
            .catch(function (err) {
                delete modal.dataset.busy;
                btn.disabled = false;
                btn.innerHTML = '<i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:6px;">download</i>下载';
                errEl.textContent = '备份失败：' + (err.message || err);
            });
        });
    }

    // Reads which sections a backup file contains. Current files list them; legacy files were a
    // raw config dump, so infer from the keys that are present.
    function detectBackupSections(parsed) {
        var info = { legacy: false, sections: new Set(), createdUtc: '', pluginVersion: '' };
        if (parsed && typeof parsed.BackupVersion === 'number') {
            (parsed.Sections || []).forEach(function (s) { info.sections.add(s); });
            info.createdUtc = parsed.CreatedUtc || '';
            info.pluginVersion = parsed.PluginVersion || '';
            return info;
        }
        info.legacy = true;
        info.sections.add('Settings');
        info.sections.add('ApiKeys');
        if (Array.isArray(parsed.Tags)) info.sections.add('Tags');
        if (Array.isArray(parsed.SavedFilters)) info.sections.add('SavedFilters');
        return info;
    }

    // onRestored(result) is called after a successful import so the page can reload its state.
    function showRestoreModal(rawText, onRestored) {
        function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

        var parsed;
        try { parsed = JSON.parse(rawText); } catch (err) {
            window.Dashboard.alert('无法解析配置文件。文件可能已损坏或不是有效的备份文件。错误：' + err.message);
            return;
        }
        if (!parsed || typeof parsed !== 'object') {
            window.Dashboard.alert('所选文件不是 Home Screen Companion 备份。');
            return;
        }
        var info = detectBackupSections(parsed);

        var fileInfo = info.legacy
            ? '旧版备份（由较早版本的插件创建）'
            : '创建时间：' + (info.createdUtc ? new Date(info.createdUtc).toLocaleString('zh-CN') : '未知') + (info.pluginVersion ? ' · 插件版本 v' + escHtml(info.pluginVersion) : '');

        var modal = buildBackupModalShell();
        modal.renderBox(
            '<h3 style="' + _backupTitleStyle + '">恢复备份</h3>' +
            '<p style="' + _backupHintStyle + 'margin-bottom:6px;">' + fileInfo + '</p>' +
            '<p style="' + _backupHintStyle + '">选择要恢复的内容。每个选中的部分都会立即<strong>替换</strong>服务器上的当前配置。未勾选的部分不受影响。</p>' +
            '<div style="margin-bottom:16px;">' + buildBackupSectionsHtml(info.sections, 'chkRestoreSection') + '</div>' +
            '<div class="backup-error" style="color:#cc3333;font-size:0.85em;min-height:1.2em;margin-bottom:6px;"></div>' +
            '<div style="display:flex;gap:10px;justify-content:flex-end;align-items:center;">' +
            '<button type="button" class="btnRestoreCancel" style="' + _backupBtnSecondary + '">取消</button>' +
            '<button type="button" class="btnRestoreApply" style="' + _backupBtnPrimary + '"><i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:6px;">upload</i>恢复</button>' +
            '</div>'
        );
        modal.querySelector('.btnRestoreCancel').addEventListener('click', modal.close);
        modal.querySelector('.btnRestoreApply').addEventListener('click', function () {
            var btn = this;
            var errEl = modal.querySelector('.backup-error');
            var flags = readBackupSectionFlags(modal, 'chkRestoreSection');
            if (!Object.keys(flags).some(function (k) { return flags[k]; })) { errEl.textContent = '请至少选择一项。'; return; }
            errEl.textContent = '';
            btn.disabled = true;
            btn.innerHTML = '正在恢复 <span class="tc-dot-loader"><span></span><span></span><span></span></span>';
            modal.dataset.busy = '1';
            var body = Object.assign({ BackupJson: rawText }, flags);
            var tok = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Backup/Import'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok },
                body: JSON.stringify(body)
            })
            .then(function (r) { if (!r.ok) throw new Error('服务器返回 ' + r.status); return r.json(); })
            .then(function (result) {
                if (!result || !result.Success) throw new Error((result && result.Message) || '未知错误');
                delete modal.dataset.busy;
                if (typeof onRestored === 'function') onRestored(result);
                renderRestoreResult(modal, result);
            })
            .catch(function (err) {
                delete modal.dataset.busy;
                btn.disabled = false;
                btn.innerHTML = '<i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:6px;">upload</i>恢复';
                errEl.textContent = '恢复失败：' + (err.message || err);
            });
        });
    }

    function renderRestoreResult(modal, result) {
        function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        var pending = result.TopListsNeedingLibrary || [];
        var listStyle = 'margin:0 0 14px;padding-left:20px;font-size:0.9em;line-height:1.5;';

        var html =
            '<div style="text-align:center;padding:4px 0 14px;">' +
            '<i class="md-icon" style="font-size:2.5em;color:#52B54B;display:block;margin-bottom:8px;">check_circle</i>' +
            '<p style="margin:0;font-size:1.05em;font-weight:500;">备份已恢复</p>' +
            '</div>' +
            '<span style="font-size:0.78em;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;opacity:0.65;display:block;margin-bottom:4px;">已应用</span>' +
            '<ul style="' + listStyle + '">' + (result.Applied || []).map(function (a) { return '<li>' + escHtml(a) + '</li>'; }).join('') + '</ul>';

        if ((result.Warnings || []).length > 0) {
            html += '<span style="font-size:0.78em;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#e0a030;display:block;margin-bottom:4px;">警告</span>' +
                '<ul style="' + listStyle + 'opacity:0.85;">' + result.Warnings.map(function (w) { return '<li>' + escHtml(w) + '</li>'; }).join('') + '</ul>';
        }

        if (pending.length > 0) {
            html += '<div style="border:1px solid rgba(224,160,48,0.5);background:rgba(224,160,48,0.08);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-size:0.9em;line-height:1.5;">' +
                '<strong>' + pending.length + ' 个榜单' + (pending.length !== 1 ? '' : '') + '需要' + (pending.length === 1 ? '' : '') + ' Emby 媒体库：</strong> ' +
                pending.map(function (p) { return escHtml(p.CustomName || p.TagName); }).join(', ') + '.<br/>' +
                '其设置和文件已恢复，但此服务器上尚无对应的媒体库。您可以立即创建（与<em>+ 新建</em>一样创建媒体库、主屏幕栏目和访问权限），也可以稍后在“榜单”选项卡中逐一打开榜单并点击“保存”。' +
                '<div class="restore-tl-progress" style="margin-top:8px;font-size:0.88em;opacity:0.8;"></div>' +
                '</div>';
        }

        html += '<p style="' + _backupHintStyle + '">之后请运行一次同步，以根据恢复的配置重建标签、合集、播放列表和主屏幕栏目。</p>' +
            '<div style="display:flex;gap:10px;justify-content:flex-end;align-items:center;padding-top:14px;border-top:1px solid var(--line-color);">' +
            (pending.length > 0 ? '<button type="button" class="btnRestoreCreateLibs" style="' + _backupBtnPrimary + '"><i class="md-icon" style="font-size:1em;vertical-align:middle;margin-right:6px;">library_add</i>立即创建媒体库</button>' : '') +
            '<button type="button" class="btnRestoreDone" style="' + (pending.length > 0 ? _backupBtnSecondary : _backupBtnPrimary) + '">关闭</button>' +
            '</div>';

        modal.renderBox(html);
        modal.querySelector('.btnRestoreDone').addEventListener('click', modal.close);

        var createBtn = modal.querySelector('.btnRestoreCreateLibs');
        if (createBtn) {
            createBtn.addEventListener('click', function () {
                createBtn.disabled = true;
                modal.querySelector('.btnRestoreDone').disabled = true;
                modal.dataset.busy = '1';
                var progressEl = modal.querySelector('.restore-tl-progress');
                var failures = [];
                // Dummy UI targets: executeTopListCreationSteps writes its status into these.
                var dummyBtn = document.createElement('button');
                var dummyErr = document.createElement('div');
                var dummyModal = document.createElement('div');

                pending.reduce(function (p, tl, idx) {
                    return p.then(function () {
                        progressEl.textContent = '正在创建 ' + (idx + 1) + ' / ' + pending.length + '：' + (tl.CustomName || tl.TagName) + '…';
                        return new Promise(function (resolve, reject) {
                            executeTopListCreationSteps(
                                tl.TagName, tl.CustomName || tl.TagName, tl.UserIds || [], tl.DisplayMode || '', tl.CustomName || tl.TagName,
                                tl.ImageType || '', tl.MaxItems || 0, { FolderPath: tl.FolderPath, FilesCreated: 0 },
                                { saveBtn: dummyBtn, errEl: dummyErr, modal: dummyModal, badgeStyle: tl.BadgeStyle || 'neutral', silent: true, closeHandler: resolve, contentType: tl.ContentType || 'Movies' }
                            ).catch(reject);
                        }).catch(function (err) {
                            failures.push((tl.CustomName || tl.TagName) + ': ' + (err && err.message ? err.message : err));
                        });
                    });
                }, Promise.resolve()).then(function () {
                    delete modal.dataset.busy;
                    modal.querySelector('.btnRestoreDone').disabled = false;
                    if (failures.length === 0) {
                        progressEl.style.color = '#52B54B';
                        progressEl.textContent = '全部 ' + pending.length + ' 个媒体库' + (pending.length === 1 ? '' : '') + '已创建。收尾工作将在后台继续进行。';
                        createBtn.style.display = 'none';
                    } else {
                        progressEl.style.color = '#cc3333';
                        progressEl.innerHTML = '部分媒体库无法创建：<br/>' + failures.map(escHtml).join('<br/>');
                        createBtn.disabled = false;
                    }
                    var tlContainer = document.querySelector('#tlContainer');
                    if (tlContainer) tlContainer.dataset.loaded = '';
                });
            });
        }
    }

    function loadTopListsTab(view) {
        var container = view.querySelector('#tlContainer');
        if (!container) return;

        container.innerHTML = '<div style="padding:20px;color:var(--theme-text-secondary);display:flex;align-items:center;gap:10px;">正在加载 <span class="tc-dot-loader"><span></span><span></span><span></span></span></div>';

        var token = window.ApiClient.accessToken();

        Promise.all([
            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Manage/Tags'), { headers: { 'X-MediaBrowser-Token': token } }).then(function (r) { return r.json(); }),
            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Manage/Collections'), { headers: { 'X-MediaBrowser-Token': token } }).then(function (r) { return r.json(); }),
            window.ApiClient.getPluginConfiguration(pluginId).catch(function () { return { Tags: [] }; }),
            fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/List'), { headers: { 'X-MediaBrowser-Token': token } }).then(function (r) { return r.json(); }).catch(function () { return { FolderNames: [] }; })
        ]).then(function (results) {
            var tagsData = results[0];
            var collectionsData = results[1];
            var pluginConfig = results[2];
            var existingTopLists = new Set((results[3].FolderNames || []).map(function (n) { return n.toLowerCase(); }));

            function sanitizeTlName(name) {
                var safe = (name || 'unknown').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').trim();
                return safe.length === 0 ? 'unknown' : safe;
            }

            var topListCustomNameMap = {};
            var topListLibraryIdMap = {};
            (pluginConfig.TopLists || []).forEach(function (tl) {
                if (!tl.TagName) return;
                var key = sanitizeTlName(tl.TagName).toLowerCase();
                var settings = {};
                try { settings = JSON.parse(tl.HomeSectionSettings || '{}'); } catch (e) {}
                if (settings.CustomName) topListCustomNameMap[key] = settings.CustomName;
                if (tl.HomeSectionLibraryId && tl.HomeSectionLibraryId !== 'auto')
                    topListLibraryIdMap[key] = tl.HomeSectionLibraryId;
            });

            var managedTagMap = {};
            var managedCollMap = {};
            var seenGroupByTag = {};
            (pluginConfig.Tags || []).forEach(function (t, idx) {
                if (!t.Tag) return;
                var tName = t.Tag.trim();
                var tKey = tName.toLowerCase();
                if (seenGroupByTag[tKey]) return;
                seenGroupByTag[tKey] = true;
                var groupLabel = (t.Name && t.Name.trim() && t.Name.trim().toLowerCase() !== tKey) ? t.Name.trim() : tName;
                var entry = { displayName: groupLabel, groupIndex: idx, groupActive: !!t.Active };
                if (!managedTagMap[tKey]) managedTagMap[tKey] = [];
                managedTagMap[tKey].push(entry);
                if (t.EnableCollection) {
                    var cName = (t.CollectionName && t.CollectionName.trim()) ? t.CollectionName.trim() : tName;
                    var cKey = cName.toLowerCase();
                    if (!managedCollMap[cKey]) managedCollMap[cKey] = [];
                    managedCollMap[cKey].push(entry);
                }
            });

            function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
            function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

            var btnStyle = 'cursor:pointer;border:none;border-radius:3px;padding:4px 12px;font-size:0.82em;font-weight:500;';

            var searchInputStyle = 'background:var(--plugin-input-bg);border:1px solid var(--plugin-input-border);border-radius:4px;padding:5px 10px;font-size:0.9em;color:var(--plugin-popup-color);width:400px;max-width:100%;';

            var realTagNamesLower = new Set((tagsData.Tags || []).map(function (t) { return (t.Name || '').toLowerCase(); }));

            var allExistingTopLists = (pluginConfig.TopLists || []).filter(function (tl) {
                return tl.TagName && existingTopLists.has(sanitizeTlName(tl.TagName).toLowerCase());
            }).map(function (tl) {
                var key = sanitizeTlName(tl.TagName || '').toLowerCase();
                var settings = {};
                try { settings = JSON.parse(tl.HomeSectionSettings || '{}'); } catch (e) {}
                return {
                    tagName:     tl.TagName || '',
                    displayName: settings.CustomName || tl.TagName || '',
                    isManual:    !realTagNamesLower.has((tl.TagName || '').toLowerCase()),
                    contentType: tl.ContentType === 'Shows' ? 'Shows' : 'Movies',
                    count:       (results[3].MovieCounts || {})[key] || 0,
                    userIds:     tl.HomeSectionUserIds || [],
                    customName:  settings.CustomName  || '',
                    displayMode: settings.DisplayMode || '',
                    imageType:   settings.ImageType   || '',
                    badgeStyle:  settings.BadgeStyle  || 'neutral',
                    maxItems:    settings.MaxItems    || 0
                };
            });

            function renderTopListRows(items) {
                if (items.length === 0) {
                    return '<div id="tlRowsList"><p style="color:var(--theme-text-secondary);font-size:0.9em;font-style:italic;padding:20px 0;">尚未创建榜单。点击 <strong>+ 新建</strong>开始创建。</p></div>';
                }
                var labelStyle = 'font-size:0.78em;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;opacity:0.65;display:block;margin-bottom:2px;';
                var rows = items.map(function (item) {
                    var isManual = item.isManual;
                    var typeBadge = isManual
                        ? '<span class="tag-indicator toplist" style="margin-left:0;margin-right:12px;flex-shrink:0;"><i class="md-icon" style="font-size:1.1em;">format_list_numbered</i> 手动</span>'
                        : '<span class="tag-indicator tag" style="margin-left:0;margin-right:12px;flex-shrink:0;"><i class="md-icon" style="font-size:1.1em;">label</i> ' + escHtml(item.tagName) + '</span>';
                    var isShows = item.contentType === 'Shows';
                    var contentBadge = isShows
                        ? '<span class="tag-indicator ct-shows" style="margin-left:0;margin-right:8px;flex-shrink:0;"><i class="md-icon" style="font-size:1.1em;">tv</i> 剧集</span>'
                        : '<span class="tag-indicator ct-movies" style="margin-left:0;margin-right:8px;flex-shrink:0;"><i class="md-icon" style="font-size:1.1em;">movie</i> 电影</span>';
                    var displayModeLabel = ({'': '始终', 'tv': '仅电视模式', 'mobile,desktop': '仅非电视模式'})[item.displayMode] || '始终';
                    var imageTypeLabel = item.imageType || '自动';
                    var maxItemsLabel  = item.maxItems ? String(item.maxItems) : '0（全部）';
                    var editJson = escAttr(JSON.stringify({
                        tagName:     item.tagName,
                        displayName: item.displayName,
                        isManual:    item.isManual,
                        contentType: item.contentType,
                        userIds:     item.userIds,
                        customName:  item.customName,
                        displayMode: item.displayMode,
                        imageType:   item.imageType,
                        badgeStyle:  item.badgeStyle,
                        maxItems:    String(item.maxItems || '0')
                    }));
                    return '<div class="tag-row" data-tlname="' + escAttr(item.tagName.toLowerCase()) + '" data-ismanual="' + (isManual ? '1' : '0') + '" data-isshows="' + (isShows ? '1' : '0') + '" data-count="' + item.count + '" data-editjson="' + editJson + '">' +
                        '<div class="tl-row-header tag-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px;cursor:pointer;">' +
                        '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">' +
                        contentBadge + typeBadge +
                        '<span class="tag-title" style="font-weight:bold;font-size:1.1em;">' + escHtml(item.displayName) + '</span>' +
                        '<span class="tag-indicator source" style="margin-left:8px;">' + item.count + (isShows ? ' 部剧集' : ' 部电影') + '</span>' +
                        '</div>' +
                        '<i class="md-icon expand-icon" style="flex-shrink:0;margin-left:12px;">expand_more</i>' +
                        '</div>' +
                        '<div class="tag-body" style="display:none;padding:15px;border-top:1px solid rgba(255,255,255,0.1);">' +
                        '</div>' +
                        '</div>';
                }).join('');
                return '<div id="tlRowsList">' + rows + '</div>';
            }

            container.innerHTML =
                '<div style="max-width:900px;">' +
                '<div class="sectionTitleContainer flex align-items-center" style="margin-bottom:1em;margin-top:2em;">' +
                '<h2 class="sectionTitle" style="margin-bottom:0;">榜单</h2>' +
                '<button type="button" id="btnCreateNewTopList" is="emby-button" class="raised button-submit mb025" style="margin-left:auto;">' +
                '<span>+ 新建</span>' +
                '</button>' +
                '</div>' +
                '<div style="margin-bottom:16px;font-size:0.9em;color:var(--theme-text-secondary);line-height:1.5;">' +
                '使用插件管理的标签，或自行挑选的电影或剧集创建榜单主屏幕栏目。每个榜单都有独立的隐藏媒体库，海报带有排名编号。' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">' +
                '<input type="text" id="tlSearch" placeholder="搜索…" style="' + searchInputStyle + '" />' +
                '<select is="emby-select" id="tlFilter" style="color:var(--plugin-popup-color);background:var(--plugin-input-bg);border:1px solid var(--plugin-input-border);padding:5px;border-radius:4px;font-size:0.9em;cursor:pointer;">' +
                '<option value="all">全部</option>' +
                '<option value="manual">手动</option>' +
                '<option value="bytag">按标签</option>' +
                '<option value="movies">电影</option>' +
                '<option value="shows">剧集</option>' +
                '</select>' +
                '<select is="emby-select" id="tlSort" style="color:var(--plugin-popup-color);background:var(--plugin-input-bg);border:1px solid var(--plugin-input-border);padding:5px;border-radius:4px;font-size:0.9em;cursor:pointer;">' +
                '<option value="name-asc">名称 A–Z</option>' +
                '<option value="name-desc">名称 Z–A</option>' +
                '<option value="count-desc">项目数最多</option>' +
                '<option value="count-asc">项目数最少</option>' +
                '</select>' +
                '<button type="button" class="btnTlRefresh" style="cursor:pointer;border:1px solid var(--line-color);background:transparent;color:var(--theme-text-secondary);border-radius:3px;padding:5px 10px;font-size:0.9em;"><i class="md-icon" style="font-size:1em;vertical-align:middle;">refresh</i></button>' +
                '</div>' +
                renderTopListRows(allExistingTopLists) +
                '</div>';

            container.dataset.loaded = '1';

            var btnCreateNew = container.querySelector('#btnCreateNewTopList');
            if (btnCreateNew) {
                btnCreateNew.addEventListener('click', function () {
                    var existingTypes = {};
                    (pluginConfig.TopLists || []).forEach(function (tl) {
                        if (tl.TagName) existingTypes[sanitizeTlName(tl.TagName).toLowerCase()] = tl.ContentType === 'Shows' ? 'Shows' : 'Movies';
                    });
                    showCreateTopListChooser(tagsData, existingTopLists, function () {
                        container.dataset.loaded = '';
                        loadTopListsTab(view);
                    }, existingTypes);
                });
            }

            function applySearchSort() {
                var query  = (container.querySelector('#tlSearch').value || '').toLowerCase();
                var filter = container.querySelector('#tlFilter').value;
                var sort   = container.querySelector('#tlSort').value;

                var rowsList = container.querySelector('#tlRowsList');
                if (!rowsList) return;
                var rows = Array.from(rowsList.querySelectorAll('.tag-row'));

                rows.forEach(function (row) {
                    var tlName   = row.dataset.tlname || '';
                    var isManual = row.dataset.ismanual === '1';
                    var isShowList = row.dataset.isshows === '1';
                    var matchSearch = !query || tlName.indexOf(query) !== -1;
                    var matchFilter = true;
                    if (filter === 'manual') matchFilter = isManual;
                    if (filter === 'bytag')  matchFilter = !isManual;
                    if (filter === 'movies') matchFilter = !isShowList;
                    if (filter === 'shows')  matchFilter = isShowList;
                    row.style.display = (matchSearch && matchFilter) ? '' : 'none';
                });

                var visibleRows = rows.filter(function (r) { return r.style.display !== 'none'; });
                visibleRows.sort(function (a, b) {
                    var nameA  = a.dataset.tlname || '';
                    var nameB  = b.dataset.tlname || '';
                    var countA = parseInt(a.dataset.count || '0', 10);
                    var countB = parseInt(b.dataset.count || '0', 10);
                    if (sort === 'name-asc')   return nameA.localeCompare(nameB);
                    if (sort === 'name-desc')  return nameB.localeCompare(nameA);
                    if (sort === 'count-desc') return countB - countA;
                    if (sort === 'count-asc')  return countA - countB;
                    return 0;
                });
                visibleRows.forEach(function (r) { rowsList.appendChild(r); });
            }

            container.querySelector('#tlSearch').addEventListener('input', applySearchSort);
            container.querySelector('#tlFilter').addEventListener('change', applySearchSort);
            container.querySelector('#tlSort').addEventListener('change', applySearchSort);

            applySearchSort();


            if (container._tlClickHandler) container.removeEventListener('click', container._tlClickHandler);
            container._tlClickHandler = function (e) {
                var rowHeader = e.target.closest('.tl-row-header');
                if (rowHeader && !e.target.closest('button')) {
                    var row = rowHeader.closest('.tag-row');
                    var body = row && row.querySelector('.tag-body');
                    var icon = rowHeader.querySelector('.expand-icon');
                    if (body) {
                        var expanded = body.style.display !== 'none';
                        body.style.display = expanded ? 'none' : 'block';
                        if (icon) icon.textContent = expanded ? 'expand_more' : 'expand_less';
                        if (!expanded && !body.dataset.formLoaded) {
                            body.dataset.formLoaded = '1';
                            loadInlineEditForm(row, body, function () { container.dataset.loaded = ''; loadTopListsTab(view); });
                        }
                    }
                    return;
                }

                var btn = e.target.closest('button');
                if (!btn) return;

                if (btn.classList.contains('btnTlDelete')) {
                    var deleteName = btn.dataset.name;
                    if (!confirm('删除“' + deleteName + '”的榜单？\n\n这将删除文件夹、所有 .strm 文件和虚拟媒体库。您的实际电影和剧集不会受到影响。')) return;
                    var deleteBtn = btn;
                    deleteBtn.disabled = true;
                    deleteBtn.textContent = '正在删除…';
                    var deleteToken = window.ApiClient.accessToken();
                        fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/TopList/Delete'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-MediaBrowser-Token': deleteToken },
                            body: JSON.stringify({ TagName: deleteName })
                        })
                        .then(function (r) { return r.json(); })
                        .then(function (delResult) {
                            if (!delResult.Success) throw new Error(delResult.Message || '删除失败');
                            var folderPath = delResult.FolderPath;
                            return fetch(window.ApiClient.getUrl('Library/VirtualFolders'), {
                                headers: { 'X-MediaBrowser-Token': deleteToken }
                            })
                            .then(function (r) { return r.json(); })
                            .then(function (folders) {
                                function normDlp(p) { return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }
                                var match = (folders || []).find(function (f) {
                                    return (f.Locations || []).some(function (loc) {
                                        return normDlp(loc) === normDlp(folderPath);
                                    });
                                });
                                if (match && match.ItemId) {
                                    return fetch(window.ApiClient.getUrl('Library/VirtualFolders') + '?Id=' + encodeURIComponent(match.ItemId) + '&RefreshLibrary=false', {
                                        method: 'DELETE',
                                        headers: { 'X-MediaBrowser-Token': deleteToken }
                                    });
                                }
                            });
                        })
                        .then(function () {
                            _topListTagNames.delete(deleteName.toLowerCase());
                            refreshTopListBadges();
                            container.dataset.loaded = '';
                            loadTopListsTab(view);
                        })
                        .catch(function (err) {
                            deleteBtn.disabled = false;
                            deleteBtn.textContent = '删除榜单';
                            alert('删除榜单时出错：' + (err.message || err));
                        });
                    return;
                }

                if (btn.classList.contains('btnTlRefresh')) {
                    container.dataset.loaded = '';
                    loadTopListsTab(view);
                    return;
                }
            };
            container.addEventListener('click', container._tlClickHandler);

        }).catch(function (err) {
            container.innerHTML = '<div style="color:#cc3333;padding:20px;">加载失败：' + err + '</div>';
        });
    }

    function loadHscManageTab(view) {
        var container = view.querySelector('#hscManageContainer');
        if (!container) return;

        window.ApiClient.getJSON(window.ApiClient.getUrl('Users', { IsDisabled: false }))
            .then(function (users) {
                var userOptions = (users || []).map(function (u) {
                    return '<option value="' + u.Id + '">' + u.Name + '</option>';
                }).join('');

                container.innerHTML = [
                    '<div class="hsc-card">',
                    '<h3 class="hsc-section-title">管理主屏幕</h3>',
                    '<p class="textMuted" style="font-size:0.88em;margin-bottom:16px;">选择用户以查看和管理其主屏幕栏目。拖动行调整顺序，然后点击保存或应用（更改将立即生效）。</p>',
                    '<div style="display:flex;align-items:flex-end;gap:10px;margin-bottom:20px;">',
                    '<div style="flex-grow:1;">',
                    '<select is="emby-select" id="selManageUser" label="用户">',
                    '<option value="">— 选择用户 —</option>',
                    userOptions,
                    '</select>',
                    '</div>',
                    '<button type="button" is="emby-button" class="raised btn-neutral" id="btnRefreshManageSections" style="height:36px;min-width:90px;margin-bottom:2px;" disabled>',
                    '<i class="md-icon" style="margin-right:4px;">refresh</i>刷新',
                    '</button>',
                    '</div>',
                    '<div id="manSectionList"></div>',
                    '<div style="margin-top:16px;display:flex;justify-content:flex-end;">',
                    '<button type="button" is="emby-button" class="raised button-submit" id="btnApplyManage" disabled>',
                    '<i class="md-icon" style="margin-right:4px;">check</i><span>应用更改</span>',
                    '</button>',
                    '</div>',
                    '</div>',
                ].join('');

                var selUser = container.querySelector('#selManageUser');
                var btnRefresh = container.querySelector('#btnRefreshManageSections');
                var listEl = container.querySelector('#manSectionList');

                selUser.addEventListener('change', function () {
                    btnRefresh.disabled = !this.value;
                    if (this.value) fetchManageSections(view, this.value);
                });

                btnRefresh.addEventListener('click', function () {
                    var uid = selUser.value;
                    if (uid) fetchManageSections(view, uid);
                });

                container.querySelector('#btnApplyManage').addEventListener('click', function () {
                    applyManageSections(view);
                });

                var manRafId = null;
                listEl.addEventListener('dragover', function (e) {
                    e.preventDefault();
                    if (manRafId) return;
                    manRafId = requestAnimationFrame(function () {
                        var draggingRow = listEl.querySelector('.man-section-row.man-dragging');
                        if (!draggingRow) { manRafId = null; return; }
                        var afterEl = getManDragAfterElement(listEl, e.clientY);
                        var ph = listEl.querySelector('.sort-placeholder');
                        if (!ph) { ph = document.createElement('div'); ph.className = 'sort-placeholder'; }
                        if (afterEl == null) { if (ph.nextElementSibling !== null) listEl.appendChild(ph); }
                        else { if (ph.nextElementSibling !== afterEl) listEl.insertBefore(ph, afterEl); }
                        manRafId = null;
                    });
                });

                listEl.addEventListener('drop', function (e) {
                    e.preventDefault();
                    var draggingRow = listEl.querySelector('.man-section-row.man-dragging');
                    var ph = listEl.querySelector('.sort-placeholder');
                    if (draggingRow && ph) {
                        listEl.insertBefore(draggingRow, ph);
                        ph.remove();
                    } else if (ph) {
                        ph.remove();
                    }
                });

                container.dataset.loaded = '1';
            })
            .catch(function () {
                container.innerHTML = '<p class="textMuted" style="padding:20px;">加载用户失败。请检查服务器连接。</p>';
            });
    }

    function fetchManageSections(view, userId) {
        var container = view.querySelector('#hscManageContainer');
        if (!container) return;
        var listEl = container.querySelector('#manSectionList');
        if (!listEl) return;

        listEl.innerHTML = '<p class="textMuted" style="padding:10px 0;">正在加载栏目...</p>';
        container.querySelector('#btnApplyManage').disabled = true;

        var headers = {};
        var token = window.ApiClient.accessToken();
        if (token) headers['X-Emby-Token'] = token;

        fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Hsc/UserSections', { userId: userId }), { headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (result) {
                currentManageSections = result.Sections || [];
                renderManageSections(view);
            })
            .catch(function () {
                listEl.innerHTML = '<p class="textMuted" style="padding:10px 0;color:#cc3333;">加载栏目失败。</p>';
            });
    }

    function renderManageSections(view) {
        var container = view.querySelector('#hscManageContainer');
        if (!container) return;
        var listEl = container.querySelector('#manSectionList');
        if (!listEl) return;

        if (currentManageSections.length === 0) {
            listEl.innerHTML = '<p class="textMuted" style="padding:10px 0;">未找到此用户的栏目。</p>';
            return;
        }

        listEl.innerHTML = currentManageSections.map(function (s, i) {
            var name = s.CustomName || s.Name || s.SectionType || ('栏目 ' + (i + 1));
            return [
                '<div class="man-section-row" draggable="false" data-section-index="' + i + '">',
                '<span class="drag-handle"><i class="md-icon">drag_indicator</i></span>',
                '<span style="flex-grow:1;">' + name + '</span>',
                '<button type="button" is="emby-button" class="man-btn-delete raised" data-section-index="' + i + '" title="移除栏目">',
                '<i class="md-icon">delete</i>',
                '</button>',
            ].join('') + '</div>';
        }).join('');

        listEl.querySelectorAll('.man-section-row').forEach(function (row) {
            var handle = row.querySelector('.drag-handle');

            handle.addEventListener('mousedown', function () { row.setAttribute('draggable', 'true'); });
            handle.addEventListener('mouseup',   function () { row.setAttribute('draggable', 'false'); });

            handle.addEventListener('touchstart', function (e) {
                e.preventDefault();
                row.classList.add('man-dragging');

                function onTouchMove(ev) {
                    ev.preventDefault();
                    var touch = ev.touches[0];
                    var afterEl = getManDragAfterElement(listEl, touch.clientY);
                    var ph = listEl.querySelector('.sort-placeholder');
                    if (!ph) { ph = document.createElement('div'); ph.className = 'sort-placeholder'; }
                    if (afterEl == null) { if (ph.nextElementSibling !== null) listEl.appendChild(ph); }
                    else { if (ph.nextElementSibling !== afterEl) listEl.insertBefore(ph, afterEl); }
                }

                function onTouchEnd() {
                    document.removeEventListener('touchmove', onTouchMove);
                    document.removeEventListener('touchend', onTouchEnd);
                    document.removeEventListener('touchcancel', onTouchCancel);
                    row.classList.remove('man-dragging');
                    var ph = listEl.querySelector('.sort-placeholder');
                    if (ph) { listEl.insertBefore(row, ph); ph.remove(); }
                    var domRows = [...listEl.querySelectorAll('.man-section-row')];
                    if (domRows.length > 0) {
                        var snapshot = currentManageSections.slice();
                        currentManageSections = domRows.map(function (r) {
                            return snapshot[parseInt(r.dataset.sectionIndex)];
                        });
                        domRows.forEach(function (r, pos) {
                            r.dataset.sectionIndex = pos;
                            var delBtn = r.querySelector('.man-btn-delete');
                            if (delBtn) delBtn.dataset.sectionIndex = pos;
                        });
                        var btnApply = container.querySelector('#btnApplyManage');
                        if (btnApply) { btnApply.disabled = false; checkFormState(); }
                    }
                }

                function onTouchCancel() {
                    document.removeEventListener('touchmove', onTouchMove);
                    document.removeEventListener('touchend', onTouchEnd);
                    document.removeEventListener('touchcancel', onTouchCancel);
                    row.classList.remove('man-dragging');
                    var ph = listEl.querySelector('.sort-placeholder');
                    if (ph) ph.remove();
                }

                document.addEventListener('touchmove', onTouchMove, { passive: false });
                document.addEventListener('touchend', onTouchEnd);
                document.addEventListener('touchcancel', onTouchCancel);
            }, { passive: false });

            row.addEventListener('dragstart', function (e) {
                row.classList.add('man-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', '');
                setTimeout(function () { row.style.display = 'none'; }, 0);
            });

            row.addEventListener('dragend', function () {
                row.style.display = '';
                row.classList.remove('man-dragging');
                row.setAttribute('draggable', 'false');
                var ph = listEl.querySelector('.sort-placeholder');
                if (ph) ph.remove();

                var domRows = [...listEl.querySelectorAll('.man-section-row')];
                if (domRows.length > 0) {
                    var snapshot = currentManageSections.slice();
                    currentManageSections = domRows.map(function (r) {
                        return snapshot[parseInt(r.dataset.sectionIndex)];
                    });
                    domRows.forEach(function (r, pos) {
                        r.dataset.sectionIndex = pos;
                        var delBtn = r.querySelector('.man-btn-delete');
                        if (delBtn) delBtn.dataset.sectionIndex = pos;
                    });
                    var btnApply = container.querySelector('#btnApplyManage');
                    if (btnApply) { btnApply.disabled = false; checkFormState(); }
                }
            });

            row.querySelector('.man-btn-delete').addEventListener('click', function () {
                currentManageSections.splice(parseInt(this.dataset.sectionIndex), 1);
                renderManageSections(view);
                var btnApply = container.querySelector('#btnApplyManage');
                if (btnApply) { btnApply.disabled = false; checkFormState(); }
            });
        });
    }

    function applyManageSections(view) {
        var container = view.querySelector('#hscManageContainer');
        if (!container) return;
        var selUser = container.querySelector('#selManageUser');
        var btnApply = container.querySelector('#btnApplyManage');
        if (!selUser || !selUser.value) return;

        btnApply.disabled = true;
        var btnSpan = btnApply.querySelector('span');
        var origText = btnSpan ? btnSpan.textContent : '';
        if (btnSpan) btnSpan.textContent = '正在应用\u2026';

        var headers = { 'Content-Type': 'application/json' };
        var token = window.ApiClient.accessToken();
        if (token) headers['X-Emby-Token'] = token;

        fetch(window.ApiClient.getUrl('HomeScreenCompanionAnime/Hsc/UserSections'), {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ UserId: selUser.value, Sections: currentManageSections })
        })
            .then(function (r) { return r.json(); })
            .then(function (result) {
                if (btnSpan) btnSpan.textContent = origText;
                if (result.Success) {
                    window.Dashboard.alert('主屏幕布局保存成功！');
                } else {
                    window.Dashboard.alert('保存失败：' + (result.Message || '未知错误'));
                    btnApply.disabled = false;
                }
            })
            .catch(function () {
                if (btnSpan) btnSpan.textContent = origText;
                window.Dashboard.alert('应用更改时出错。请检查服务器日志。');
                btnApply.disabled = false;
            });
    }


    return function (view) {
        view.addEventListener('viewshow', () => {
            // Emby fires viewhide/viewshow when the app is paused/resumed (browser tab switch, window
            // loses focus). Don't rebuild the form then, or unsaved edits and expanded rows are lost.
            if (view._hscPaused && view.dataset.hscInit) {
                view._hscPaused = false;
                if (statusInterval) clearInterval(statusInterval);
                refreshStatus(view);
                statusInterval = setInterval(() => refreshStatus(view), 5000);
                return;
            }
            view._hscPaused = false;

            if (!document.getElementById('homeScreenCompanionCustomCss')) {
                document.body.insertAdjacentHTML('beforeend', customCss);
            }
            applyPluginTheme();

            var form = view.querySelector('.HomeScreenCompanionForm');
            var isFirstVisit = !view.dataset.hscInit;
            if (isFirstVisit) view.dataset.hscInit = '1';

            originalConfigState = null;

            var changeHandler = function() {
                setTimeout(checkFormState, 0);
            };
            if (_formAc) _formAc.abort();
            _formAc = new AbortController();
            var _signal = _formAc.signal;
            form.addEventListener('input', changeHandler, { signal: _signal });
            form.addEventListener('change', changeHandler, { signal: _signal });
            form.addEventListener('input', function (e) {
                var ta = e.target.closest('textarea.txtMiValue, textarea.txtTagBlacklist');
                if (!ta) return;
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
                ta.style.overflowY = ta.scrollHeight > 120 ? 'auto' : 'hidden';
            });
            var settingsTab = view.querySelector('#tabSettings');
            settingsTab.addEventListener('input',  changeHandler, { signal: _signal });
            settingsTab.addEventListener('change', changeHandler, { signal: _signal });
            settingsTab.addEventListener('input', function () { updateAiHttpWarning(view); }, { signal: _signal });
            settingsTab.addEventListener('change', function () { updateAiHttpWarning(view); }, { signal: _signal });
            var animeTabEl = view.querySelector('#tabAnimeCollections');
            if (animeTabEl) {
                animeTabEl.addEventListener('input', changeHandler, { signal: _signal });
                animeTabEl.addEventListener('change', changeHandler, { signal: _signal });
            }
            view.querySelector('#btnRefreshAnimeAiAnalysis').addEventListener('click', function () {
                loadAnimeAiAnalysis(view);
            }, { signal: _signal });
            view.querySelector('#btnTestAnimeAiConnection').addEventListener('click', function () {
                var button = this;
                var result = view.querySelector('#animeAiConnectionResult');
                button.disabled = true;
                result.textContent = '正在测试连接…';
                Promise.resolve().then(function () {
                    return animeAiRequest('TestConnection', getUiConfig(view, false));
                }).then(function (response) {
                    result.textContent = (response.Success ? '连接成功：' : '连接失败：') +
                        (response.Message || (response.Success ? '服务响应正常。' : '请检查配置。')) +
                        (response.Warning ? '\n' + response.Warning : '');
                }).catch(function (error) {
                    result.textContent = '连接测试失败：' + (error.message || '网络或响应异常。');
                }).then(function () { button.disabled = false; });
            }, { signal: _signal });

            var spTa = view.querySelector('#txtAiSystemPrompt');
            var resetBtn = view.querySelector('#btnResetAiSystemPrompt');
            if (spTa && resetBtn) {
                spTa.addEventListener('input', function () { updateSystemPromptResetBtn(view); }, { signal: _signal });
                resetBtn.addEventListener('click', function () {
                    spTa.value = DEFAULT_AI_SYSTEM_PROMPT;
                    updateSystemPromptResetBtn(view);
                    changeHandler();
                }, { signal: _signal });
            }

            form.addEventListener('click', (e) => {
                var dayBtn = e.target.closest('.day-toggle');
                if (dayBtn) dayBtn.classList.toggle('active');
                if (e.target.closest('.btnRemoveUrl, .btnAddUrl, .btnRemoveLocal, .btnAddLocal, .btnRemoveDate, .btnAddDate, .btnRemoveFilterGroup, .btnAddMediaInfoFilter, .btnClearAllFilters, .btnGroupOpChoice, .btnGroupInnerOpChoice, .btnAddMiRule, .btnRemoveMiRule, .btnRemoveGroup, .day-toggle, .btnRemovePoster, .btnApplyMiPreset')) {
                    changeHandler();
                }
            }, { signal: _signal });
            
            var container = view.querySelector('#tagListContainer');

            if (isFirstVisit) {
                if (container) {
                    let rafId = null;
                    container.addEventListener('dragover', (e) => {
                        if (localStorage.getItem('HomeScreenCompanion_SortBy') !== 'Manual') return;
                        e.preventDefault();
                        if (rafId) return;
                        rafId = requestAnimationFrame(() => {
                            const draggingRow = document.querySelector('.tag-row.dragging');
                            if (!draggingRow) { rafId = null; return; }
                            const afterElement = getDragAfterElement(container, e.clientY);
                            var placeholder = document.querySelector('.sort-placeholder');
                            if (!placeholder) {
                                placeholder = document.createElement('div');
                                placeholder.className = 'sort-placeholder';
                            }
                            if (afterElement == null) {
                                if (placeholder.nextElementSibling !== null) container.appendChild(placeholder);
                            } else {
                                if (placeholder.nextElementSibling !== afterElement) container.insertBefore(placeholder, afterElement);
                            }
                            rafId = null;
                        });
                    });
                    container.addEventListener('drop', (e) => {
                        if (localStorage.getItem('HomeScreenCompanion_SortBy') !== 'Manual') return;
                        e.preventDefault();
                        const draggingRow = document.querySelector('.tag-row.dragging');
                        const placeholder = document.querySelector('.sort-placeholder');
                        if (draggingRow && placeholder) {
                            container.insertBefore(draggingRow, placeholder);
                            placeholder.remove();
                            changeHandler();
                        }
                    });
                }



                var logOverlay = view.querySelector('#logModalOverlay');
                var helpOverlay = view.querySelector('#helpModalOverlay');
                var bugOverlay = view.querySelector('#bugReportModalOverlay');

                view.querySelector('#btnOpenLogs').addEventListener('click', e => { e.preventDefault(); _logTab = null; renderLogModal(view); logOverlay.classList.add('modal-visible'); });
                var animeLogBtn = view.querySelector('#btnAnimeOpenLogs');
                if (animeLogBtn) animeLogBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    _logTab = 'anime';
                    renderLogModal(view);
                    logOverlay.classList.add('modal-visible');
                });
                var reminderFilter = view.querySelector('#animeRemindersFilter');
                if (reminderFilter) {
                    view._animeReminderFilter = view._animeReminderFilter || 'open';
                    reminderFilter.querySelectorAll('button[data-filter]').forEach(function (btn) {
                        btn.addEventListener('click', function () {
                            view._animeReminderFilter = btn.getAttribute('data-filter') || 'open';
                            reminderFilter.querySelectorAll('button[data-filter]').forEach(function (b) {
                                b.classList.toggle('active', b === btn);
                            });
                            renderAnimeReminders(view, view._animeLastSummary || {});
                        });
                    });
                }
                var animeEditorBack = view.querySelector('#btnAnimeEditorBack');
                if (animeEditorBack) animeEditorBack.addEventListener('click', function () { showAnimeStudioMain(view); });
                var animeEditorSave = view.querySelector('#btnAnimeEditorSave');
                if (animeEditorSave) animeEditorSave.addEventListener('click', function () { saveAnimeCollectionEditor(view); });
                var animeEditorAuto = view.querySelector('#btnAnimeEditorAuto');
                if (animeEditorAuto) animeEditorAuto.addEventListener('click', function () { clearAnimeCollectionEditorRule(view); });
                var animeEditorSearchInput = view.querySelector('#txtAnimeEditorSearch');
                if (animeEditorSearchInput) {
                    var searchTimer = null;
                    animeEditorSearchInput.addEventListener('input', function () {
                        var q = animeEditorSearchInput.value || '';
                        if (searchTimer) clearTimeout(searchTimer);
                        searchTimer = setTimeout(function () { animeEditorSearch(view, q); }, 220);
                    });
                    animeEditorSearchInput.addEventListener('focus', function () {
                        animeEditorSearch(view, animeEditorSearchInput.value || '');
                    });
                    animeEditorSearchInput.addEventListener('blur', function () {
                        setTimeout(function () {
                            var results = view.querySelector('#animeEditorSearchResults');
                            if (results) results.style.display = 'none';
                        }, 180);
                    });
                }
                view.querySelector('#btnCloseLogs').addEventListener('click', () => { _logTab = null; logOverlay.classList.remove('modal-visible'); });
                logOverlay.addEventListener('click', e => { if (e.target === logOverlay) { _logTab = null; logOverlay.classList.remove('modal-visible'); } });
                view.querySelectorAll('#logTabs .log-tab').forEach(function (tab) {
                    tab.addEventListener('click', function () { _logTab = tab.getAttribute('data-log'); renderLogModal(view); });
                });

                view.querySelector('#btnOpenHelp').addEventListener('click', () => helpOverlay.classList.add('modal-visible'));
                view.querySelector('#btnCloseHelp').addEventListener('click', () => helpOverlay.classList.remove('modal-visible'));
                helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) helpOverlay.classList.remove('modal-visible'); });

                view.querySelector('#btnOpenBugReport').addEventListener('click', () => bugOverlay.classList.add('modal-visible'));
                view.querySelector('#btnCloseBugReport').addEventListener('click', () => bugOverlay.classList.remove('modal-visible'));
                bugOverlay.addEventListener('click', e => { if (e.target === bugOverlay) bugOverlay.classList.remove('modal-visible'); });

                var miHelpOverlay = view.querySelector('#miHelpModalOverlay');
                view.querySelector('#btnCloseMiHelp').addEventListener('click', () => miHelpOverlay.classList.remove('modal-visible'));
                miHelpOverlay.addEventListener('click', e => { if (e.target === miHelpOverlay) miHelpOverlay.classList.remove('modal-visible'); });

                var tagTargetHelpOverlay = view.querySelector('#tagTargetHelpModalOverlay');
                view.querySelector('#btnCloseTagTargetHelp').addEventListener('click', () => tagTargetHelpOverlay.classList.remove('modal-visible'));
                tagTargetHelpOverlay.addEventListener('click', e => { if (e.target === tagTargetHelpOverlay) tagTargetHelpOverlay.classList.remove('modal-visible'); });

                var headerAction = view.querySelector('.sectionTitleContainer');
                if (headerAction && !view.querySelector('#cbSortTags')) {
                    var savedSort = localStorage.getItem('HomeScreenCompanion_SortBy') || 'Manual';
                    headerAction.style.display = "flex";
                    headerAction.style.alignItems = "center";
                    headerAction.style.justifyContent = "space-between";
                    headerAction.style.width = "100%";
                    headerAction.style.marginBottom = "10px";

                    var controlRowHtml = `
                    <div class="control-row" style="flex-direction: row !important; align-items: center !important; flex-wrap: nowrap !important; justify-content: flex-start !important; padding: 10px 15px !important; gap: 0 !important;">

                        <span class="control-label" style="opacity:0.7; margin-right: 10px; flex-shrink: 0;">排序：</span>

                        <select is="emby-select" id="cbSortTags" style="color:inherit; background:rgba(128,128,128,0.08); border:1px solid var(--line-color); padding:5px; border-radius:4px; font-size:0.9em; cursor:pointer; width: 80px; margin-right: 0px;">
                            <option value="Manual" ${savedSort === 'Manual' ? 'selected' : ''}>手动</option>
                            <option value="Name" ${savedSort === 'Name' ? 'selected' : ''}>名称</option>
                            <option value="Active" ${savedSort === 'Active' ? 'selected' : ''}>状态</option>
                            <option value="LatestEdited" ${savedSort === 'LatestEdited' ? 'selected' : ''}>最近编辑</option>
                        </select>

                        <div style="width: 1px; height: 25px; background: var(--line-color); margin-right: 10px;"></div>

                        <span class="control-label" style="opacity:0.7; margin-right: 10px; flex-shrink: 0;"> | 筛选：</span>

                        <div class="search-input-wrapper" style="width: 200px !important; margin-right: 10px; flex-shrink: 0;">
                            <i class="md-icon search-icon">search</i>
                            <input type="text" id="txtSearchTags" placeholder="搜索..." autocomplete="off" style="padding-left: 28px !important; background: rgba(128,128,128,0.06) !important; border: 1px solid var(--line-color) !important; width: 100% !important;" />
                            <i class="md-icon" id="btnClearSearch">close</i>
                        </div>

                        <div class="filter-dropdown-wrapper">
                            <div class="filter-dropdown-btn" id="btnFilterDropdown">
                                <i class="md-icon" style="font-size:1.1em;">filter_list</i>
                                <span id="filterDropdownLabel">筛选</span>
                                <i class="md-icon" style="font-size:0.9em; opacity:0.6;" id="filterDropdownCaret">expand_more</i>
                            </div>
                            <div class="filter-dropdown-panel" id="filterDropdownPanel">
                                <div class="filter-dropdown-label">功能</div>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterTag" /><span>标签</span></label>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterCollection" /><span>合集</span></label>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterSchedule" /><span>计划</span></label>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterHomeScreen" /><span>主屏幕栏目</span></label>
                                <div class="filter-dropdown-divider"></div>
                                <div class="filter-dropdown-label">来源</div>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterSrcExternal" /><span>外部</span></label>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterSrcMediaInfo" /><span>本地媒体信息</span></label>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterSrcCollection" /><span>本地合集</span></label>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterSrcPlaylist" /><span>本地播放列表</span></label>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterSrcAI" /><span>AI 创建的列表</span></label>
                                <div class="filter-dropdown-divider"></div>
                                <div class="filter-dropdown-label">状态</div>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterActive" /><span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:#52B54B;flex-shrink:0;"></span>已启用</span></label>
                                <label class="filter-chk-row"><input type="checkbox" id="chkFilterInactive" /><span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:rgba(128,128,128,0.5);flex-shrink:0;"></span>未启用</span></label>
                            </div>
                        </div>

                    </div>`;

                    headerAction.insertAdjacentHTML('afterend', controlRowHtml);

                    const txtSearch = view.querySelector('#txtSearchTags');
                    const btnClear = view.querySelector('#btnClearSearch');

                    txtSearch.addEventListener('input', () => {
                        btnClear.style.display = txtSearch.value ? 'block' : 'none';
                        applyFilters(view);
                    });

                    btnClear.addEventListener('click', () => {
                        txtSearch.value = '';
                        btnClear.style.display = 'none';
                        txtSearch.focus();
                        applyFilters(view);
                    });

                    view.querySelector('#cbSortTags').addEventListener('change', function () {
                        localStorage.setItem('HomeScreenCompanion_SortBy', this.value);
                        sortRows(view.querySelector('#tagListContainer'), this.value);
                    });

                    ['#chkFilterTag','#chkFilterCollection','#chkFilterSchedule','#chkFilterHomeScreen',
                     '#chkFilterSrcExternal','#chkFilterSrcMediaInfo','#chkFilterSrcCollection','#chkFilterSrcPlaylist',
                     '#chkFilterSrcAI','#chkFilterActive','#chkFilterInactive'
                    ].forEach(id => view.querySelector(id).addEventListener('change', () => applyFilters(view)));

                    var dropBtn   = view.querySelector('#btnFilterDropdown');
                    var dropPanel = view.querySelector('#filterDropdownPanel');
                    var dropCaret = view.querySelector('#filterDropdownCaret');

                    dropBtn.addEventListener('click', e => {
                        e.stopPropagation();
                        var open = dropPanel.classList.toggle('open');
                        dropCaret.textContent = open ? 'expand_less' : 'expand_more';
                    });

                    document.addEventListener('click', function closeFilterDrop(e) {
                        if (!dropPanel.contains(e.target) && e.target !== dropBtn) {
                            dropPanel.classList.remove('open');
                            dropCaret.textContent = 'expand_more';
                        }
                    });
                }

                view.querySelector('#btnAddTag').addEventListener('click', () => {
                    renderTagGroup({ Tag: '', Urls: [{ url: '', limit: 0 }], Active: true }, view.querySelector('#tagListContainer'), true, undefined, true);
                    applyFilters(view);
                });

                view.querySelector('#btnBackupConfig').addEventListener('click', function () {
                    showBackupModal();
                });

                var fileInput = view.querySelector('#fileRestoreConfig');
                view.querySelector('#btnRestoreConfigTrigger').addEventListener('click', function () {
                    if (hasDirtyState() && !confirm('您有未保存的更改，恢复备份时这些更改将被丢弃。是否继续？')) return;
                    fileInput.click();
                });
                fileInput.addEventListener('change', function (e) {
                    var file = e.target.files[0]; if (!file) return;
                    var reader = new FileReader();
                    reader.onload = function (ev) {
                        fileInput.value = '';
                        showRestoreModal(ev.target.result, function () {
                            // Server config changed underneath us — reload every tab from scratch.
                            ['#hscContainer', '#hscManageContainer', '#tlContainer', '#tcManageContainer'].forEach(function (sel) {
                                var el = view.querySelector(sel);
                                if (el) el.dataset.loaded = '';
                            });
                            loadConfig().then(function () {
                                refreshMySavedFiltersPanels();
                                var activeTab = view.querySelector('.page-tab-btn.active');
                                var target = activeTab ? activeTab.getAttribute('data-page-tab') : '';
                                if (target === 'HomeCompanion') { loadHscUsers(view); loadHscManageTab(view); }
                                else if (target === 'TopLists') loadTopListsTab(view);
                                else if (target === 'Cleanup') loadTagManageTab(view);
                            });
                        });
                    };
                    reader.readAsText(file);
                });

            }

            if (!view.querySelector('.dry-run-warning')) {
                view.insertAdjacentHTML('afterbegin', '<div class="dry-run-warning"><i class="md-icon" style="font-size:1.4em;"></i>仅预览模式已启用 - 不会保存任何更改</div>');
            }

            var btnSave = view.querySelector('.btn-save');
            if (btnSave) { btnSave.disabled = true; btnSave.style.opacity = "0.5"; }

            checkForUpdates(view);
            refreshStatus(view);
            statusInterval = setInterval(() => refreshStatus(view), 5000);
            getHseUsers().then(function(users) { _miUsers = users; });

            Promise.all([
                window.ApiClient.getJSON(window.ApiClient.getUrl("Users/" + window.ApiClient.getCurrentUserId() + "/Items", { IncludeItemTypes: "BoxSet", Recursive: true })),
                window.ApiClient.getJSON(window.ApiClient.getUrl("Items", { IncludeItemTypes: "Playlist", Recursive: true })),
                window.ApiClient.getJSON(window.ApiClient.getUrl("Items/Filters2", { UserId: window.ApiClient.getCurrentUserId(), Recursive: true })).catch(function () { return { Tags: [] }; })
            ]).then(responses => {
                cachedCollections = responses[0].Items || [];
                cachedPlaylists = responses[1].Items || [];
                cachedTags = ((responses[2] && responses[2].Tags) || []).slice().sort();

                loadConfig();
            });
        });

        view.addEventListener('viewhide', (e) => {
            if (statusInterval) clearInterval(statusInterval);
            // App pause hides the current view without a new one; real navigation always has newViewInfo.
            view._hscPaused = !!(e.detail && e.detail.newViewInfo === null);
        });

        view.querySelector('.HomeScreenCompanionForm').addEventListener('submit', e => {
            e.preventDefault();

            // Flush dirty inline top-list forms before the global config save.
            // Must happen first because the global save re-fetches TopLists from the server.
            var _tlCont = view.querySelector('#tlContainer');
            var _dirtyBodies = _tlCont ? Array.from(_tlCont.querySelectorAll('.tag-body[data-dirty="1"]')) : [];
            if (_dirtyBodies.length > 0) {
                var _btn = view.querySelector('.btn-save');
                var _origHtml = _btn ? _btn.innerHTML : '';
                if (_btn) { _btn.disabled = true; _btn.innerHTML = '<i class="md-icon" style="margin-right:5px;">hourglass_empty</i><span>正在保存…</span>'; }
                _dirtyBodies.reduce(function (p, b) {
                    return p.then(function () { return typeof b.tlSaveForm === 'function' ? b.tlSaveForm() : Promise.resolve(); });
                }, Promise.resolve()).then(function () {
                    _dirtyBodies.forEach(function (b) { delete b.dataset.dirty; });
                    if (_btn) { _btn.innerHTML = _origHtml; _btn.disabled = false; }
                    doSave();
                }).catch(function (err) {
                    if (_btn) { _btn.innerHTML = _origHtml; _btn.disabled = false; }
                    alert('保存榜单更改失败：' + (err.message || err));
                });
                return;
            }
            doSave();
            function doSave() {
            try { validateAnimePolicy(view); }
            catch (error) { alert(error.message); return; }

            // If CLEANUP tab is active and has pending deletions, show its modal instead of normal config save
            var cleanupTab = view.querySelector('#tabCleanup');
            var tcContainer = view.querySelector('#tcManageContainer');
            if (cleanupTab && cleanupTab.style.display !== 'none' && tcContainer && tcContainer._tcHasPending && tcContainer._tcShowModal) {
                tcContainer._tcShowModal();
                return;
            }

            var btnApplyManage = view.querySelector('#btnApplyManage');
            if (btnApplyManage && !btnApplyManage.disabled) applyManageSections(view);

            var configObj = getUiConfig(view, false);
            
            var originalConf = JSON.parse(originalConfigState);
            var originalTags = groupConfigTags(originalConf.Tags);

            configObj.Tags.forEach(tag => {
                var key = tag.Name ? tag.Name + '\x1F' + tag.Tag : tag.Tag;
                var originalTag = originalTags[key];
                
                var currentTagForCompare = Object.assign({}, tag, { LastModified: "CONSTANT_FOR_COMPARISON" });
                var originalTagForCompare = originalTag ? Object.assign({}, originalTag, { LastModified: "CONSTANT_FOR_COMPARISON" }) : null;

                if (!originalTag || JSON.stringify(currentTagForCompare) !== JSON.stringify(originalTagForCompare)) {
                    tag.LastModified = new Date().toISOString();
                } else {
                    tag.LastModified = originalTag.LastModified;
                }
            });

            // Pre-fetch current config to preserve HomeSectionTracked set by the sync task
            // (UI dataset may be stale if sync ran after page load)
            window.ApiClient.getPluginConfiguration(pluginId).then(function(currentConfig) {
                var currentGrouped = groupConfigTags(currentConfig.Tags);
                configObj.Tags.forEach(function(t) {
                    var key = t.Name ? t.Name + '\x1F' + t.Tag : t.Tag;
                    var existing = currentGrouped[key];
                    if (existing && existing.HomeSectionTracked && existing.HomeSectionTracked.length > 0
                        && (!t.HomeSectionTracked || t.HomeSectionTracked.length === 0)) {
                        t.HomeSectionTracked = existing.HomeSectionTracked;
                    }
                    if (existing && existing.PlaylistMappings && existing.PlaylistMappings.length > 0
                        && (!t.PlaylistMappings || t.PlaylistMappings.length === 0)) {
                        t.PlaylistMappings = existing.PlaylistMappings;
                    }
                });
                configObj.TopLists = currentConfig.TopLists || [];

                // Ensure all items-type home sections exclude top-list libraries automatically
                return preFetchLibraryData().then(function(libData) {
                    var topListIds = new Set(
                        libData.virtualFolders
                            .filter(function(f) {
                                return (f.Locations || []).some(function(loc) {
                                    var parts = loc.replace(/\\/g, '/').split('/');
                                    var fn = (parts[parts.length - 1] || parts[parts.length - 2] || '').toLowerCase();
                                    return libData.topListFolderNames.has(fn);
                                });
                            })
                            .map(function(f) { return f.ItemId; })
                    );
                    if (topListIds.size > 0) {
                        configObj.Tags.forEach(function(tag) {
                            if (!tag.EnableHomeSection) return;
                            var settings = {};
                            try { settings = JSON.parse(tag.HomeSectionSettings || '{}'); } catch {}
                            if ((settings.SectionType || 'items') !== 'items') return;
                            var excluded = new Set(
                                (settings._queryExcludeViewIds || '').split(',')
                                    .map(function(id) { return id.trim(); }).filter(Boolean)
                            );
                            var changed = false;
                            topListIds.forEach(function(id) {
                                if (!excluded.has(id)) { excluded.add(id); changed = true; }
                            });
                            if (changed) {
                                var excStr = Array.from(excluded).join(',');
                                settings._queryExcludeViewIds = excStr;
                                settings.ExcludedFolders = excStr;
                                tag.HomeSectionSettings = JSON.stringify(settings);
                            }
                        });
                    }
                    return window.ApiClient.updatePluginConfiguration(pluginId, Object.assign({}, currentConfig, configObj));
                });
            }).then(r => {
                window.Dashboard.processPluginConfigurationUpdateResult(r);
                _topListTagNames = new Set((configObj.TopLists || []).map(function (tl) { return (tl.TagName || '').toLowerCase(); }).filter(Boolean));

                var newGrouped = groupConfigTags(configObj.Tags);
                view.querySelectorAll('.tag-row').forEach(row => {
                    if (!row.querySelector('.txtEntryLabel')) return;
                    var name = row.querySelector('.txtEntryLabel').value;
                    var tagName = row.querySelector('.txtTagName').value || name;
                    var key = name ? name + '\x1F' + tagName : tagName;
                    var tc = newGrouped[key];
                    if (tc) {
                        row.dataset.lastModified = tc.LastModified;
                        var hseTab = row.querySelector('.homescreen-tab');
                        if (hseTab) {
                            hseTab.dataset.hseTracked = encodeURIComponent(JSON.stringify(tc.HomeSectionTracked || []));
                            hseTab.dataset.hseSettings = encodeURIComponent(tc.HomeSectionSettings || '{}');
                            hseTab.dataset.hseUserids = encodeURIComponent(JSON.stringify(tc.HomeSectionUserIds || []));
                        }
                    }
                });

                originalConfigState = JSON.stringify(getUiConfig(view, true));
                checkFormState();
                updateDryRunWarning();

                // Apply home section settings immediately for existing tracked sections (fire-and-forget)
                configObj.Tags.forEach(function(tc) {
                    if (!tc.EnableHomeSection) return;
                    var hasTracked = (tc.HomeSectionTracked || []).some(function(t) {
                        return t.SectionId && !t.SectionId.startsWith('hsc__');
                    });
                    if (!hasTracked) return;
                    var applyUrl = window.ApiClient.getUrl('HomeScreenCompanionAnime/Hsc/ApplyTagHomeSections');
                    var tok = window.ApiClient.accessToken ? window.ApiClient.accessToken() : '';
                    fetch(applyUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Emby-Token': tok },
                        body: JSON.stringify({ TagName: tc.Name || tc.Tag })
                    }).then(function(r) { return r.json(); }).then(function(res) {
                        console.log('[HSC] ApplyTagHomeSections', tc.Name || tc.Tag, res);
                    }).catch(function(e) { console.warn('[HSC] ApplyTagHomeSections 失败', tc.Name || tc.Tag, e); });
                });
            });
            } // end doSave
        });

        var speedDial = view.querySelector('#runSpeedDial');
        var syncMenu = view.querySelector('#runSyncMenu');
        view.querySelector('#btnRunSync').addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = speedDial.classList.toggle('open');
            syncMenu.classList.toggle('open', isOpen);
        });

        function closeSpeedDial() {
            speedDial.classList.remove('open');
            syncMenu.classList.remove('open');
        }
        document.addEventListener('click', closeSpeedDial);

        function runTask(key, label) {
            window.ApiClient.getScheduledTasks().then(function (tasks) {
                var t = tasks.find(function (x) { return x.Key === key; });
                if (t) {
                    window.ApiClient.startScheduledTask(t.Id).then(function () {
                        window.Dashboard.alert(label + ' 已启动！');
                    });
                } else {
                    window.Dashboard.alert('未找到任务：' + key);
                }
            });
            closeSpeedDial();
        }

        view.querySelector('#btnDialTagsCollections').addEventListener('click', function () {
            runTask('HomeScreenCompanionSyncTask', '标签同步');
        });

        var animeDial = view.querySelector('#btnDialAnimeCollections');
        if (animeDial) animeDial.addEventListener('click', function () {
            closeSpeedDial();
            switchToAnimeTab(view);
            runAnimeCollectionTask(view);
        });

        var animeRunNow = view.querySelector('#btnAnimeRunNow');
        if (animeRunNow) animeRunNow.addEventListener('click', function () { runAnimeCollectionTask(view); });
        var animeGoStudio = view.querySelector('#btnAnimeGoToStudio');
        if (animeGoStudio) animeGoStudio.addEventListener('click', function () { switchToAnimeTab(view); });
        var scheduledWrite = view.querySelector('#chkAnimeScheduledWrite');
        if (scheduledWrite) {
            scheduledWrite.addEventListener('change', function () { syncAnimeCheckboxFromScheduled(view); });
        }
        var dryRunChk = view.querySelector('#chkDryRunMode');
        if (dryRunChk) dryRunChk.addEventListener('change', function () { updateAnimeGlobalDryHint(view); });
        var confirmCancel = view.querySelector('#btnAnimeConfirmCancel') || document.getElementById('btnAnimeConfirmCancel');
        if (confirmCancel) confirmCancel.addEventListener('click', function () { closeAnimeConfirmPanel(view); });
        var confirmCreate = view.querySelector('#btnAnimeConfirmCreate') || document.getElementById('btnAnimeConfirmCreate');
        if (confirmCreate) confirmCreate.addEventListener('click', function () { submitAnimeConfirmCreate(view); });
        var confirmToggleOk = view.querySelector('#btnAnimeConfirmToggleOk') || document.getElementById('btnAnimeConfirmToggleOk');
        if (confirmToggleOk) {
            confirmToggleOk.addEventListener('click', function () {
                var okList = view.querySelector('#animeConfirmOkList') || document.getElementById('animeConfirmOkList');
                if (!okList) return;
                var open = okList.style.display === 'none';
                okList.style.display = open ? '' : 'none';
                confirmToggleOk.textContent = open ? '收起' : '展开';
            });
        }
        var confirmOverlay = view.querySelector('#animeConfirmOverlay') || document.getElementById('animeConfirmOverlay');
        if (confirmOverlay) {
            confirmOverlay.addEventListener('click', function (ev) {
                if (ev.target === confirmOverlay) closeAnimeConfirmPanel(view);
            });
        }

        view.querySelector('#btnDialHomeScreen').addEventListener('click', function () {
            runTask('HomeSectionSyncTask', '主屏幕同步');
        });

        view.querySelector('#btnDialFullSync').addEventListener('click', function () {
            window.ApiClient.getScheduledTasks().then(function (tasks) {
                var tagTask = tasks.find(function (x) { return x.Key === 'HomeScreenCompanionSyncTask'; });
                var hscTask = tasks.find(function (x) { return x.Key === 'HomeSectionSyncTask'; });
                var promises = [];
                if (tagTask) promises.push(window.ApiClient.startScheduledTask(tagTask.Id));
                if (hscTask) promises.push(window.ApiClient.startScheduledTask(hscTask.Id));
                Promise.all(promises).then(function () {
                    window.Dashboard.alert('完整同步已启动！');
                });
            });
            closeSpeedDial();
        });

        function beforeUnloadHandler(e) {
            if (hasDirtyState()) {
                e.preventDefault();
                e.returnValue = '';
            }
        }
        window.addEventListener('beforeunload', beforeUnloadHandler);

        function onViewHideCleanup() {
            if (view._hscPaused) return;
            document.removeEventListener('click', closeSpeedDial);
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            view.removeEventListener('viewhide', onViewHideCleanup);
        }
        view.addEventListener('viewhide', onViewHideCleanup);

        function loadConfig() {
            _hseLibraryCachePromise = null; // återställ cache så nya bibliotek (t.ex. ny top-list) hämtas
            preFetchLibraryData();          // starta hämtning direkt vid sidladdning
            return window.ApiClient.getPluginConfiguration(pluginId).then(config => {
                lastHscConfig = {
                    HomeSyncEnabled:       config.HomeSyncEnabled       || false,
                    HomeSyncLibraryOrder:  config.HomeSyncLibraryOrder  || false,
                    HomeSyncSourceUserId:  config.HomeSyncSourceUserId  || '',
                    HomeSyncTargetUserIds: config.HomeSyncTargetUserIds || [],
                    ContinueWatchingBumpEnabled:  config.ContinueWatchingBumpEnabled  || false,
                    ContinueWatchingBumpMode:     config.ContinueWatchingBumpMode     || 'AllEpisodes',
                    ContinueWatchingBumpAllUsers: config.ContinueWatchingBumpAllUsers || false,
                    ContinueWatchingBumpUserIds:  config.ContinueWatchingBumpUserIds  || []
                };
                savedFilters = config.SavedFilters || [];

                var container = view.querySelector('#tagListContainer'); container.innerHTML = '';
                view.querySelector('#txtTraktClientId').value = config.TraktClientId || '';
                view.querySelector('#txtMdblistApiKey').value = config.MdblistApiKey || '';
                view.querySelector('#txtTmdbApiKey').value = config.TmdbApiKey || '';
                var oaElInit = view.querySelector('#txtOpenAiApiKey'); if (oaElInit) oaElInit.value = config.OpenAiApiKey || '';
                var oamElInit = view.querySelector('#txtOpenAiModel'); if (oamElInit) oamElInit.value = config.OpenAiModel || 'gpt-4o-mini';
                var gmElInit = view.querySelector('#txtGeminiApiKey'); if (gmElInit) gmElInit.value = config.GeminiApiKey || '';
                var gmmElInit = view.querySelector('#txtGeminiModel'); if (gmmElInit) gmmElInit.value = config.GeminiModel || 'gemini-2.5-flash-lite';
                var clElInit = view.querySelector('#txtClaudeApiKey'); if (clElInit) clElInit.value = config.ClaudeApiKey || '';
                var clmElInit = view.querySelector('#txtClaudeModel'); if (clmElInit) clmElInit.value = config.ClaudeModel || 'claude-haiku-4-5-20251001';
                var olElInit = view.querySelector('#txtOllamaBaseUrl'); if (olElInit) olElInit.value = config.OllamaBaseUrl || 'http://localhost:11434';
                var omElInit = view.querySelector('#txtOllamaModel'); if (omElInit) omElInit.value = config.OllamaModel || '';
                var spElInit = view.querySelector('#txtAiSystemPrompt'); if (spElInit) spElInit.value = config.AiSystemPrompt || ''; updateSystemPromptResetBtn(view);
                view.querySelector('#chkExtendedConsoleOutput').checked = config.ExtendedConsoleOutput || false;
                view.querySelector('#chkLogMissingItems').checked = config.LogMissingItems || false;
                view.querySelector('#chkDryRunMode').checked = config.DryRunMode || false;
                view.querySelector('#chkPreserveTagsOnEmptyResult').checked = config.PreserveTagsOnEmptyResult || false;
                view.querySelector('#chkTopListMirrorCollections').checked = config.TopListMirrorCollections || false;
                view.querySelector('#chkAnimeEnabled').checked = config.AnimeEnabled || false;
                view.querySelector('#chkAnimeDryRun').checked = !!config.AnimeDryRun;
                view.querySelector('#chkAnimeIncludeSpinOffs').checked = config.AnimeIncludeSpinOffs !== false;
                var skipRem = view.querySelector('#chkAnimeSkipWriteWhenReminders');
                if (skipRem) skipRem.checked = !!config.AnimeSkipWriteWhenReminders;
                syncAnimeModeFromCheckbox(view);
                view.querySelector('#chkAnimeAiOther').checked = config.AnimeAiReviewOtherEdges || false;
                view.querySelector('#selAnimeAiProvider').value = config.AnimeAiProvider || 'OpenAICompatible';
                view.querySelector('#txtCompatibleAiBaseUrl').value = config.CompatibleAiBaseUrl || '';
                view.querySelector('#txtCompatibleAiModel').value = config.CompatibleAiModel || '';
                view.querySelector('#txtCompatibleAiApiKey').value = config.CompatibleAiApiKey || '';
                view.querySelector('#chkAnimeAiNaming').checked = config.AnimeAiNamingEnabled || false;
                view.querySelector('#chkAnimeAiCollectionReview').checked = config.AnimeAiCollectionReviewEnabled || false;
                view.querySelector('#txtAnimeAiMaxCalls').value = config.AnimeAiMaxCallsPerRun == null ? 15 : config.AnimeAiMaxCallsPerRun;
                view.querySelector('#txtAnimeAiMaxTokensPerCall').value = config.AnimeAiMaxTokensPerCall == null ? 800 : config.AnimeAiMaxTokensPerCall;
                view.querySelector('#txtAnimeAiMaxTokensPerRun').value = config.AnimeAiMaxTokensPerRun == null ? 4000 : config.AnimeAiMaxTokensPerRun;
                updateAiHttpWarning(view);
                loadAnimeAiAnalysis(view);
                view.querySelector('#txtAnimePrefix').value = config.AnimeCollectionPrefix || '动漫 · ';
                view.querySelector('#txtAnimeApiBudget').value = config.AnimeMaxRequestsPerRun || 300;
                view.querySelector('#txtAnimeCollectionRulesJson').value = config.AnimeCollectionRulesJson || '';
                view.querySelector('#txtAnimeApprovedCollectionKeys').value = config.AnimeApprovedCollectionKeys || '';
                view.querySelector('#txtAnimeCollectionAliasesJson').value = config.AnimeCollectionAliasesJson || '';
                var mapUrlEl = view.querySelector('#txtAnimeMappingUrl');
                if (mapUrlEl) mapUrlEl.value = config.AnimeMappingUrl || '';
                updateCompatibleAiVisibility(view);

                if (view.querySelector('#txtSearchTags')) {
                    view.querySelector('#txtSearchTags').value = '';
                    view.querySelector('#btnClearSearch').style.display = 'none';
                }
                ['#chkFilterTag','#chkFilterCollection','#chkFilterSchedule','#chkFilterHomeScreen',
                 '#chkFilterSrcExternal','#chkFilterSrcMediaInfo','#chkFilterSrcCollection','#chkFilterSrcPlaylist',
                 '#chkFilterSrcAI','#chkFilterActive','#chkFilterInactive'
                ].forEach(id => { var el = view.querySelector(id); if (el) el.checked = false; });
                var lbl = view.querySelector('#filterDropdownLabel'); if (lbl) lbl.textContent = '筛选';
                var btn = view.querySelector('#btnFilterDropdown'); if (btn) btn.classList.remove('active');

                _topListTagNames = new Set((config.TopLists || []).map(function (tl) { return (tl.TagName || '').toLowerCase(); }).filter(Boolean));

                var grouped = groupConfigTags(config.Tags);

                var keys = Object.keys(grouped);
                keys.forEach((k, i) => renderTagGroup(grouped[k], container, false, i));

                if (keys.length === 0) renderTagGroup({ Tag: '', Urls: [{ url: '', limit: 0 }], Active: true }, container, false, 0, true);

                var savedSort = localStorage.getItem('HomeScreenCompanion_SortBy') || 'Manual';
                sortRows(container, savedSort);
                applyFilters(view);
                requestAnimationFrame(function () {
                    try {
                        originalConfigState = JSON.stringify(getUiConfig(view, true));
                    } catch (err) {
                        originalConfigState = null;
                    }
                    checkFormState();
                    updateDryRunWarning();
                });
            });
        }

        function hasDirtyState() {
            var btnSave = view.querySelector('.btn-save');
            if (btnSave && !btnSave.disabled) return true;
            var tcContainer = view.querySelector('#tcManageContainer');
            if (tcContainer && tcContainer._tcHasPending) return true;
            return false;
        }

        view.querySelectorAll('.page-tab-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = this.getAttribute('data-page-tab');
                var wasDirty = hasDirtyState();
                if (wasDirty && !confirm('您有未保存的更改。要离开此选项卡并放弃更改吗？')) return;
                if (wasDirty) loadConfig();
                view.querySelectorAll('.page-tab-btn').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                view.querySelectorAll('.page-tab-content').forEach(function (c) { c.style.display = 'none'; });
                view.querySelector('#tab' + target).style.display = '';

                if (target === 'HomeCompanion') {
                    var hscContainer = view.querySelector('#hscContainer');
                    if (hscContainer && !hscContainer.dataset.loaded) {
                        loadHscUsers(view);
                    }
                    var manageContainer = view.querySelector('#hscManageContainer');
                    if (manageContainer && !manageContainer.dataset.loaded) {
                        loadHscManageTab(view);
                    }
                } else if (target === 'Cleanup') {
                    var container = view.querySelector('#tcManageContainer');
                    if (container && !container.dataset.loaded) loadTagManageTab(view);
                } else if (target === 'TopLists') {
                    var tlContainer = view.querySelector('#tlContainer');
                    if (tlContainer && !tlContainer.dataset.loaded) loadTopListsTab(view);
                } else if (target === 'AnimeCollections') {
                    view._animeSummaryLoaded = false;
                    loadAnimeLastRunSummary(view).then(function () { view._animeSummaryLoaded = true; });
                    updateAnimeGlobalDryHint(view);
                }
            });
        });

        view.addEventListener('change', function (e) {
            var cb = e.target.closest('.chkShowApiKey');
            if (!cb) return;
            var input = view.querySelector('#' + cb.dataset.target);
            if (input) input.type = cb.checked ? 'text' : 'password';
        });

        view.addEventListener('click', function (e) {
            var header = e.target.closest('.settings-panel-toggle');
            if (header) {
                var panel = header.closest('.settings-panel');
                if (panel) {
                    var body = panel.querySelector('.settings-panel-body');
                    var chevron = header.querySelector('.settings-panel-chevron');
                    if (body) {
                        var isOpen = body.style.display !== 'none';
                        body.style.display = isOpen ? 'none' : 'block';
                        if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
                    }
                }
                return;
            }
        });

        view.addEventListener('click', function (e) {
            var btn = e.target.closest('.hsc-sub-tab-btn');
            if (!btn) return;
            var target = btn.getAttribute('data-hsc-tab');
            view.querySelectorAll('.hsc-sub-tab-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            view.querySelectorAll('.hsc-sub-tab-content').forEach(function (c) { c.style.display = 'none'; });
            if (target === 'copy') {
                view.querySelector('#hscSubTabCopy').style.display = '';
                var hscContainer = view.querySelector('#hscContainer');
                if (hscContainer && !hscContainer.dataset.loaded) loadHscUsers(view);
            } else if (target === 'tweaks') {
                view.querySelector('#hscSubTabTweaks').style.display = '';
                var hstContainer = view.querySelector('#hstContainer');
                if (hstContainer && !hstContainer.dataset.loaded) loadHstTab(view);
            } else if (target === 'manage') {
                view.querySelector('#hscSubTabManage').style.display = '';
                var manageContainer = view.querySelector('#hscManageContainer');
                if (manageContainer && !manageContainer.dataset.loaded) loadHscManageTab(view);
            }
        });


        var origStatusInterval = statusInterval;
        if (origStatusInterval) clearInterval(origStatusInterval);
        statusInterval = setInterval(function () {
            refreshStatus(view);
        }, 5000);
    };
});