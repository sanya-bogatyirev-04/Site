'use strict';

/* ============================================================
   1. Настройки и справочники
   ============================================================ */

/** Вкладки сценариев. Сценарий отчёта определяется по имени модели — см. detectScenarioKey. */
const SCENARIOS = [
    { key: 'А', title: 'Сценарий А' },
    { key: 'Б', title: 'Сценарий Б' },
    { key: 'В', title: 'Сценарий В' },
    { key: 'Г', title: 'Сценарий Г' }
];

/** Варианты = узлы <scenario key="..."> xml-отчёта. */
const VARIANTS = [
    { key: 'match_above',    title: 'Вариант 1', note: '(совпадает / > 92%)' },
    { key: 'mismatch_above', title: 'Вариант 2', note: '(не совпадает / > 92%)' },
    { key: 'match_below',    title: 'Вариант 3', note: '(совпадает / < 92%)' },
    { key: 'mismatch_below', title: 'Вариант 4', note: '(не совпадает / < 92%)' }
];

/** Подписи оси диаграммы, пока данные не загружены. */
const PLACEHOLDER_CATEGORIES = [
    { name: 'Колонна',             code: 'ЭЛ 30 16 40' },
    { name: 'Свая',                code: 'ЭЛ 10 10 10' },
    { name: 'Фундаментная плита',  code: 'ЭЛ 10 10 30 04' },
    { name: 'Плита козырька',      code: 'ЭЛ 30 10 58' },
    { name: 'Ростверк',            code: 'ЭЛ 10 10 12 04' },
    { name: 'Подпорная стена',     code: 'ЭЛ 10 20 40' },
    { name: 'Стена',               code: 'ЭЛ 30 10 15' },
    { name: 'Перекрытие',          code: 'ЭЛ 30 10 40' },
    { name: 'Парапет',             code: 'ЭЛ 30 10 36' },
    { name: 'Балка',               code: 'ЭЛ 30 16 20' },
    { name: 'Пилон',               code: 'ЭЛ 30 16 50' },
    { name: 'Капитель',            code: 'ЭЛ 30 16 25' },
    { name: 'Лестничный марш',     code: 'ЭЛ 30 24 10' },
    { name: 'Лестничная площадка', code: 'ЭЛ 30 24 20' },
    { name: 'Пандус',              code: 'ЭЛ 30 24 40' },
    { name: 'Плита балкона',       code: 'ЭЛ 30 10 56' },
    { name: 'Плита лоджии',        code: 'ЭЛ 30 10 57' },
    { name: 'Проём',               code: 'ЭЛ 30 14 10' },
    { name: 'Отверстие',           code: 'ЭЛ 30 14 20' },
    { name: 'Термовкладыш',        code: 'ЭЛ 30 10 71' },
    { name: 'Иное',                code: 'ЭЛ ХХ ХХ ХХ' }
];

/** Категория для элементов, класс которых не распознал агент */
const OTHER_CATEGORY = { name: 'Иное', code: 'ЭЛ ХХ ХХ ХХ' };

/** Карточка-заглушка блока «Детализация статистики». */
const PLACEHOLDER_CATEGORY_STATS = {
    name: 'Категория элемента', code: 'ЭЛ ХХ ХХ ХХ', percent: 0, total: null, topConfusedClasses: null
};

const REPORT_ROOT_TAG = 'msskReport'; // корневой атрибут по которому определяем подходит ли нам отчёт (если атрибута нет -> отчёт не подходит)
const REPORT_MODEL_ATTRIBUTE = 'model'; // параметр в корневом атрибуте по которому определяем имя модели 

const CONFIDENCE_THRESHOLD = 92;
const CHART_Y_TICKS = [100, CONFIDENCE_THRESHOLD, 75, 50, 25];
const TOP_LIST_SIZE = 3;
const NOTICE_DURATION_MS = 5000; // на какое время будет показываться уведомление
const NOTICE_TEXT_NO_REPORTS = 'Не найдены отчёты для данного дашборда, выберите другую папку';
const NOTICE_TEXT_NO_SCENARIO_REPORTS = 'Для сценария {сценарий} не найдены отчёты для данного дашборда';

const HIGHLIGHT_DURATION_MS = 1500;
const BAR_ANIMATION_DURATION_MS = 600;
const BAR_ANIMATION_STAGGER_MS = 60; // задержка между соседними столбцами для анимации
const TO_TOP_SCROLL_RATIO = 0.5; // сколько процентов экрана требуется прокрутить чтобы появилась стрелка

const PDF_PAGE_WIDTH_MM = 297;
const PDF_RENDER_SCALE = 2;
const PDF_JPEG_QUALITY = 0.92;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SVG_STYLE_PROPERTIES = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size',
    'font-weight', 'text-anchor', 'dominant-baseline'];

/* ============================================================
   2. Разбор xml-отчёта
   ============================================================ */

/**
 * Определяет сценарий (А/Б/В/Г) по имени модели: это символ перед последней точкой
 * полного имени («СколтехМодель 5А.ifc» → А, «МП4МКДБ2ВКРЭ20R23В.ifc» → В).
 * @param {string} modelName полное имя модели с расширением
 * @returns {string|null} null — символ перед расширением не является буквой сценария
 */
function detectScenarioKey(modelName) {
    const extensionDotIndex = modelName.lastIndexOf('.');
    if (extensionDotIndex < 1) return null;
    const scenarioKey = modelName[extensionDotIndex - 1].toUpperCase();
    return SCENARIOS.some(scenario => scenario.key === scenarioKey) ? scenarioKey : null;
}

function isKnownClassName(className) {
    return Boolean(className) && !/^unknown$/i.test(className);
}

/** Читает пару «код + наименование» из дочернего узла (<agentValue>, <operatorValue>). */
function readClass(elementNode, tagName) {
    const node = elementNode.querySelector(':scope > ' + tagName);
    return {
        code: node ? (node.getAttribute('code') || '').trim() : '',
        name: node ? (node.getAttribute('name') || '').trim() : ''
    };
}

/**
 * Категория элемента = его верный класс:
 *   агент подтверждён (changed="false")                — класс агента;
 *   перевыбрано       (changed="true", applied="true")  — класс, выбранный оператором (ТОП-2/ТОП-3);
 *   галка снята       (changed="true", applied="false") — старое значение элемента, которое
 *                     отчёт пишет в operatorValue.
 * «Иное» — элементы, верный класс которых неизвестен: галка снята, а старое значение
 * пустое, либо класс не распознан («Unknown»).
 */
function resolveCategory(isError, agentClass, operatorClass) {
    const source = isError ? operatorClass : agentClass;
    if (!isKnownClassName(source.name)) return OTHER_CATEGORY;
    return { name: source.name, code: source.code.replace(/^\((.*)\)$/, '$1') };
}

/**
 * Разбирает текст xml-отчёта.
 * Ошибка агента определяется по changed="true" у элемента; applied уточняет её вид:
 * галка снята (applied="false") или выбран другой вариант (applied="true").
 * @param {string} xmlText
 * @returns {{modelName: string, elements: Array<ReportElement>}}
 * @throws {Error} файл не xml, нет корневого узла <msskReport> или в нём не указана модель
 * @typedef {Object} ReportElement
 * @property {string} variantKey ключ варианта (VARIANTS[i].key)
 * @property {boolean} isError оператор изменил решение агента: снял галку либо выбрал ТОП-2/ТОП-3
 * @property {boolean} isRejected ошибка вида «галка снята» (applied="false"), а не «перевыбрано»
 * @property {string} agentClassName класс, предложенный агентом (ТОП-1)
 * @property {string} operatorClassName класс, утверждённый оператором
 * @property {string[]} agentProposals всё, что агент предложил оператору:
 *           один класс в вариантах ≥ 92% и три (ТОП-1..3) в вариантах < 92%
 * @property {{name: string, code: string}} category категория элемента, см. resolveCategory
 */
function parseReport(xmlText) {
    const xmlDocument = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xmlDocument.querySelector('parsererror')) {
        throw new Error('Файл повреждён или не является xml');
    }
    const rootNode = xmlDocument.documentElement;
    if (rootNode.nodeName !== REPORT_ROOT_TAG) {
        throw new Error('Нет корневого узла <' + REPORT_ROOT_TAG + '> (найден <' + rootNode.nodeName + '>)');
    }
    const modelName = (rootNode.getAttribute(REPORT_MODEL_ATTRIBUTE) || '').trim();
    if (!modelName) {
        throw new Error('У <' + REPORT_ROOT_TAG + '> не заполнен атрибут ' + REPORT_MODEL_ATTRIBUTE);
    }

    const elements = [];
    for (const scenarioNode of rootNode.querySelectorAll(':scope > scenarios > scenario')) {
        const variantKey = scenarioNode.getAttribute('key');

        for (const elementNode of scenarioNode.querySelectorAll(':scope > elements > element')) {
            const isError = elementNode.getAttribute('changed') === 'true';
            const isRejected = isError && elementNode.getAttribute('applied') === 'false';
            const agentClass = readClass(elementNode, 'agentValue');
            const operatorClass = readClass(elementNode, 'operatorValue');
            const optionNames = Array.from(
                elementNode.querySelectorAll(':scope > options > option'),
                optionNode => (optionNode.getAttribute('name') || '').trim()
            );

            elements.push({
                variantKey: variantKey,
                isError: isError,
                guid: elementNode.getAttribute('guid') || '',
                isRejected: isRejected,
                agentClassName: agentClass.name,
                operatorClassName: operatorClass.name,
                agentProposals: optionNames.length ? optionNames : [agentClass.name],
                category: resolveCategory(isError, agentClass, operatorClass)
            });
        }
    }
    return { modelName: modelName, elements: elements };
}

/* ============================================================
   3. Расчёт статистики
   ============================================================ */

function incrementCounter(counter, key) {
    counter.set(key, (counter.get(key) || 0) + 1);
}

/**
 * Возвращает до `limit` самых частых ключей счётчика Map<string, number>.
 * sharePercent — доля ключа от суммы всего счётчика (а не только показанных строк).
 * @returns {Array<{name: string, sharePercent: number}>}
 */
function getMostFrequentKeys(counter, limit) {
    let totalCount = 0;
    for (const count of counter.values()) totalCount += count;

    return Array.from(counter.entries())
        .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0], 'ru'))
        .slice(0, limit)
        .map(entry => ({ name: entry[0], sharePercent: calculatePercent(entry[1], totalCount) }));
}

function isOtherCategory(categoryName) {
    return categoryName === OTHER_CATEGORY.name;
}

function calculatePercent(part, total) {
    return total > 0 ? Math.round(part / total * 100) : 0;
}

/**
 * Блок «Распределение по вариантам».
 *   всего экземпляров — число элементов варианта;
 *   допущено ошибок   — элементы, изменённые оператором (changed): отключённые и перевыбранные;
 *   точность          — доля элементов без ошибки, %;
 *   топ-3 проблемных  — категории, в которых больше всего ошибок.
 * @param {Array<ReportElement>} elements
 * @returns {Object<string, {accuracy: number, total: number, errors: number, topProblemClasses: Array}>}
 *          ключ — VARIANTS[i].key
 */
function calculateVariantStats(elements) {
    const totals = {};
    for (const variant of VARIANTS) {
        totals[variant.key] = { total: 0, errors: 0, errorsByCategory: new Map() };
    }

    for (const element of elements) {
        const variantTotals = totals[element.variantKey];
        if (!variantTotals) continue;
        variantTotals.total++;
        if (element.isError) {
            variantTotals.errors++;
            incrementCounter(variantTotals.errorsByCategory, element.category.name);
        }
    }

    const stats = {};
    for (const variant of VARIANTS) {
        const variantTotals = totals[variant.key];
        stats[variant.key] = {
            accuracy: calculatePercent(variantTotals.total - variantTotals.errors, variantTotals.total),
            total: variantTotals.total,
            errors: variantTotals.errors,
            topProblemClasses: getMostFrequentKeys(variantTotals.errorsByCategory, TOP_LIST_SIZE)
        };
    }
    return stats;
}

/**
 * Блоки «Общая статистика» и «Детализация статистики» — показатели по каждой категории
 * по всем четырём вариантам, отсортированные по убыванию процента
 *   всего экземпляров — подтверждённые предсказания категории + ошибки, отнесённые к ней;
 *   процент           — доля подтверждённых от «всего»;
 *   топ-3 классов     — с какими классами агент чаще всего путал категорию. Только по ошибкам:
 *                       всё, что агент предложил для ошибочного элемента категории
 *                       (ТОП-1 при ≥ 92%, ТОП-1..3 при < 92%), кроме самой категории.
 * @param {Array<ReportElement>} elements
 * @returns {Array<{name: string, code: string, percent: number, total: number, topConfusedClasses: Array}>}
 */
function calculateCategoryStats(elements) {
    const groups = new Map();        // «код|наименование» -> показатели категории
    const groupsByName = new Map();  // наименование -> те же показатели
    const errorElements = [];

    for (const element of elements) {
        const category = element.category;
        const groupKey = category.code + '|' + category.name;
        let group = groups.get(groupKey);
        if (!group) {
            group = { name: category.name, code: category.code, total: 0, confirmed: 0, confusedWith: new Map() };
            groups.set(groupKey, group);
            groupsByName.set(category.name, group);
        }
        group.total++;
        if (element.isError) errorElements.push(element);
        else group.confirmed++;
    }

    for (const element of errorElements) {
        const ownGroup = groupsByName.get(element.category.name);
        for (const proposedName of new Set(element.agentProposals)) {
            if (isKnownClassName(proposedName) && proposedName !== ownGroup.name) {
                incrementCounter(ownGroup.confusedWith, proposedName);
            }
        }

    }

    return Array.from(groups.values(), group => ({
        name: group.name,
        code: group.code,
        percent: calculatePercent(group.confirmed, group.total),
        total: group.total,
        topConfusedClasses: getMostFrequentKeys(group.confusedWith, TOP_LIST_SIZE)
    })).sort((first, second) =>
        isOtherCategory(first.name) - isOtherCategory(second.name) ||
        second.percent - first.percent || second.total - first.total || first.name.localeCompare(second.name, 'ru'));
}

/* ============================================================
   4. Состояние страницы
   ============================================================ */

const state = {
    activeScenarioKey: SCENARIOS[0].key,
    isFolderChosen: false,
    reports: [],
    excludedModelKeys: new Set()
};

const dom = {
    scenarioTabs: document.getElementById('scenarioTabs'),
    chooseFolderButton: document.getElementById('chooseFolderBtn'),
    folderInput: document.getElementById('folderInput'),
    exportPdfButton: document.getElementById('exportPdfBtn'),
    registryList: document.getElementById('registryList'),
    content: document.getElementById('content'),
    toTopButton: document.getElementById('toTopBtn'),
    variantCards: document.getElementById('variants'),
    barChart: document.getElementById('chart'),
    categoryCards: document.getElementById('details'),
    notice: document.getElementById('notice'),
    noticeText: document.getElementById('noticeText')
};

/** Отчёты активного сценария. */
function getActiveReports() {
    return state.reports.filter(report => report.scenarioKey === state.activeScenarioKey);
}

function getModelKey(modelName) {
    return state.activeScenarioKey + '|' + modelName;
}

function isModelIncluded(modelName) {
    return !state.excludedModelKeys.has(getModelKey(modelName));
}

/** Модели активного сценария по алфавиту; одна модель из разных отчётов — одна строка. */
function getActiveModelNames() {
    const modelNames = new Set(getActiveReports().map(report => report.modelName));
    return Array.from(modelNames).sort((first, second) => first.localeCompare(second, 'ru', { numeric: true }));
}

/** Элементы активного сценария из моделей, отмеченных в реестре. */
function getActiveElements() {
    return getActiveReports()
        .filter(report => isModelIncluded(report.modelName))
        .flatMap(report => report.elements);
}

/* ============================================================
   5. Отрисовка
   ============================================================ */

function createElement(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function formatCount(count) {
    return count === null || count === undefined ? 'шт' : count.toLocaleString('ru-RU') + ' шт';
}

/** Вкладки создаются один раз; при переключении меняется только активный класс. */
function renderScenarioTabs() {
    dom.scenarioTabs.replaceChildren(...SCENARIOS.map(scenario => {
        const tab = createElement('button', 'tab', scenario.title);
        tab.type = 'button';
        tab.dataset.scenarioKey = scenario.key;
        return tab;
    }));
}

function highlightActiveScenarioTab() {
    for (const tab of dom.scenarioTabs.children) {
        tab.classList.toggle('tab--active', tab.dataset.scenarioKey === state.activeScenarioKey);
    }
}

function createRegistryRow(text, options) {
    const row = createElement('li');
    const label = createElement('label', 'registry__item' + (options.isPlaceholder ? ' registry__item--placeholder' : ''));
    const checkbox = createElement('input', 'registry__check');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(options.isChecked);
    checkbox.disabled = Boolean(options.isPlaceholder);
    if (!options.isPlaceholder) {
        checkbox.dataset.modelName = text;
        label.title = text;
    }
    label.append(checkbox, createElement('span', 'registry__box'), createElement('span', 'registry__name', text));
    row.append(label);
    return row;
}

function renderRegistry() {
    const modelNames = getActiveModelNames();
    if (modelNames.length === 0) {
        const placeholderText = state.isFolderChosen ? 'Нет моделей' : 'Выберите папку';
        dom.registryList.replaceChildren(createRegistryRow(placeholderText, { isPlaceholder: true }));
        return;
    }
    dom.registryList.replaceChildren(...modelNames.map(modelName =>
        createRegistryRow(modelName, { isChecked: isModelIncluded(modelName) })));
}

/** Заголовок и ровно три строки списка; недостающие строки — прочерки. */
function appendTopList(parent, title, topClasses) {
    parent.append(createElement('p', 'stat__label', title));
    for (let index = 0; index < TOP_LIST_SIZE; index++) {
        const topClass = topClasses && topClasses[index];
        if (!topClass) {
            parent.append(createElement('p', 'stat__item stat__item--empty', '-'));
            continue;
        }
        const row = createElement('p', 'stat__item', '- ' + topClass.name);
        row.append(createElement('span', 'stat__share', topClass.sharePercent + '%')); // доля в списке
        parent.append(row);
    }
}

/** @param {Object|null} statsByVariant результат calculateVariantStats; null — пустые карточки */
function renderVariantCards(statsByVariant) {
    dom.variantCards.replaceChildren(...VARIANTS.map(variant => {
        const stats = statsByVariant ? statsByVariant[variant.key] : null;

        const title = createElement('div', 'variant__title', variant.title);
        title.append(createElement('span', 'variant__note', variant.note));
        const accuracy = createElement('div', 'variant__accuracy', (stats ? stats.accuracy : 0) + '%');
        accuracy.append(createElement('span', 'variant__note', 'точность'));
        const head = createElement('div', 'variant__head');
        head.append(title, accuracy);

        const card = createElement('article', 'variant');
        card.append(
            head,
            createElement('p', 'stat__label', 'Всего экземпляров:'),
            createElement('p', 'stat__value', formatCount(stats && stats.total)),
            createElement('p', 'stat__label', 'Допущено ошибок:'),
            createElement('p', 'stat__value', formatCount(stats && stats.errors))
        );
        appendTopList(card, 'Топ-3 проблемных класса:', stats && stats.topProblemClasses);
        return card;
    }));
}

/** @param {Array|null} categoryStats результат calculateCategoryStats; null или [] — пустые оси */
function renderBarChart(categoryStats) {
    const hasData = Boolean(categoryStats && categoryStats.length);
    const axisCategories = hasData ? categoryStats : PLACEHOLDER_CATEGORIES;

    const plot = createElement('div', 'chart__plot');
    for (const tickValue of CHART_Y_TICKS) {
        const tick = createElement('span', 'chart__tick', String(tickValue));
        tick.style.bottom = tickValue + '%';
        plot.append(tick);
    }
    const thresholdLine = createElement('div', 'chart__threshold');
    thresholdLine.style.bottom = CONFIDENCE_THRESHOLD + '%';

    const bars = createElement('div', 'chart__bars');
    const labels = createElement('div', 'chart__labels');
    axisCategories.forEach((category, categoryIndex) => {
        const slot = createElement('div', 'chart__slot');
        if (hasData) {
            const bar = createElement('div', 'chart__bar');
            bar.style.height = category.percent + '%';
            bar.dataset.value = category.percent;        // число над столбцом при наведении
            bar.dataset.categoryIndex = categoryIndex;   // связь с карточкой в детализации
            slot.append(bar);
        }
        bars.append(slot);

        const labelText = createElement('span', 'chart__label-text');
        labelText.append(
            createElement('span', 'chart__label-name', category.name),
            createElement('span', 'chart__label-code', category.code)
        );
        const label = createElement('div', 'chart__label');
        label.append(labelText);
        labels.append(label);
    });

    plot.append(thresholdLine, bars);
    dom.barChart.replaceChildren(plot, labels);

    animateBarChart(); // анимация построения;
}

/**
 * Анимация построения диаграммы
 */
function animateBarChart() {
    dom.barChart.querySelectorAll('.chart__bar').forEach((bar, barIndex) => {
        bar.animate(
            [{ height: '0%' }, { height: bar.style.height }],
            {
                duration: BAR_ANIMATION_DURATION_MS,
                delay: barIndex * BAR_ANIMATION_STAGGER_MS,
                easing: 'ease-out',
                fill: 'backwards'
            }
        );
    });
}

/** Кольцевая диаграмма: заливка идёт от «3 часов» по часовой стрелке. */
function createDonutChart(percent) {
    const VIEW_SIZE = 120;
    const RING_RADIUS = 49.7;
    const RING_WIDTH = 20.6;
    const ringLength = 2 * Math.PI * RING_RADIUS;

    const createRing = className => {
        const ring = document.createElementNS(SVG_NAMESPACE, 'circle');
        ring.setAttribute('class', className);
        ring.setAttribute('cx', VIEW_SIZE / 2);
        ring.setAttribute('cy', VIEW_SIZE / 2);
        ring.setAttribute('r', RING_RADIUS);
        ring.setAttribute('stroke-width', RING_WIDTH);
        return ring;
    };

    const valueRing = createRing('donut__value');
    valueRing.setAttribute('stroke-dasharray', (ringLength * percent / 100) + ' ' + ringLength);

    const percentText = document.createElementNS(SVG_NAMESPACE, 'text');
    percentText.setAttribute('class', 'donut__text');
    percentText.setAttribute('x', VIEW_SIZE / 2);
    percentText.setAttribute('y', VIEW_SIZE / 2);
    percentText.textContent = percent + '%';

    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('class', 'donut');
    svg.setAttribute('viewBox', '0 0 ' + VIEW_SIZE + ' ' + VIEW_SIZE);
    svg.append(createRing('donut__track'), valueRing, percentText);
    return svg;
}

function getCategoryCardId(categoryIndex) {
    return 'detail-' + categoryIndex;
}

/** @param {Array|null} categoryStats результат calculateCategoryStats; null или [] — две карточки-заглушки */
function renderCategoryCards(categoryStats) {
    const cards = categoryStats && categoryStats.length
        ? categoryStats
        : [PLACEHOLDER_CATEGORY_STATS, PLACEHOLDER_CATEGORY_STATS];

    dom.categoryCards.replaceChildren(...cards.map((category, categoryIndex) => {
        const info = createElement('div', 'detail__info');
        info.append(
            createElement('h3', 'detail__title', category.name),
            createElement('p', 'detail__code', category.code),
            createElement('p', 'stat__label', 'Всего экземпляров:'),
            createElement('p', 'stat__value', formatCount(category.total))
        );
        appendTopList(info, 'Топ-3 предложенных класса:', category.topConfusedClasses);

        const card = createElement('article', 'detail');
        card.id = getCategoryCardId(categoryIndex);
        card.append(info, createDonutChart(category.percent));
        return card;
    }));
}

/** Пересчитывает и перерисовывает три блока с данными. */
function renderStatistics() {
    const elements = getActiveElements();
    if (elements.length === 0) {
        renderVariantCards(null);
        renderBarChart(null);
        renderCategoryCards(null);
        return;
    }

    const categoryStats = calculateCategoryStats(elements);
    renderVariantCards(calculateVariantStats(elements));
    renderBarChart(categoryStats);
    renderCategoryCards(categoryStats);
}

let noticeTimerId = null;

/**
 * Уведомление о пустом дашборде: появляется над кнопкой выбора папки после выбора папки
 * или смены сценария, если не обработан ни один отчёт вообще либо ни один отчёт
 * активного сценария, и само исчезает через NOTICE_DURATION_MS.
 */
function renderNotice() {
    let message = '';
    if (state.isFolderChosen && state.reports.length === 0) {
        message = NOTICE_TEXT_NO_REPORTS;
    } else if (state.isFolderChosen && getActiveReports().length === 0) {
        message = NOTICE_TEXT_NO_SCENARIO_REPORTS.replace('{сценарий}', state.activeScenarioKey);
    }

    clearTimeout(noticeTimerId);
    dom.noticeText.textContent = message;
    dom.notice.hidden = !message;
    if (message) {
        noticeTimerId = setTimeout(() => { dom.notice.hidden = true; }, NOTICE_DURATION_MS);
    }
}

/** Перерисовывает всё, что зависит от сценария и набора отчётов. */
function renderPage() {
    dom.chooseFolderButton.textContent = state.isFolderChosen ? 'Изменить папку' : 'Выбрать папку';
    highlightActiveScenarioTab();
    renderRegistry();
    renderStatistics();
    renderNotice();
}

/* ============================================================
   6. Действия пользователя
   ============================================================ */

let lastFolderRequestId = 0;
let highlightTimerId = null;

/**
 * Защита от задвоения
 */
function removeDuplicateElements(reports) {
    const seenGuidsByModel = new Map();
    for (const report of reports) {
        if (!seenGuidsByModel.has(report.modelName)) seenGuidsByModel.set(report.modelName, new Set());
        const seenGuids = seenGuidsByModel.get(report.modelName);
        const elementCount = report.elements.length;

        report.elements = report.elements.filter(element => {
            if (!element.guid) return true;
            if (seenGuids.has(element.guid)) return false;
            seenGuids.add(element.guid);
            return true;
        });

        const duplicateCount = elementCount - report.elements.length;
        if (duplicateCount > 0) {
            console.warn('Модель «' + report.modelName + '»: пропущено повторов элементов — ' + duplicateCount);
        }
    }
    return reports;
}

/** Читает и разбирает все xml из выбранной папки. Файлы, которые не удалось разобрать, пропускаются. */
async function loadReportsFromFolder(fileList) {
    const requestId = ++lastFolderRequestId;
    const xmlFiles = Array.from(fileList).filter(file => /\.xml$/i.test(file.name));

    const parsedReports = await Promise.all(xmlFiles.map(async file => {
        try {
            const report = parseReport(await file.text());
            const scenarioKey = detectScenarioKey(report.modelName);
            if (!scenarioKey) {
                throw new Error('по имени модели «' + report.modelName + '» не удалось определить сценарий');
            }
            return { scenarioKey: scenarioKey, modelName: report.modelName, elements: report.elements };
        } catch (error) {
            console.warn('Файл пропущен: ' + file.name + ' — ' + error.message);
            return null;
        }
    }));
    if (requestId !== lastFolderRequestId) return; // пока читали, выбрали другую папку

    state.isFolderChosen = true;
    state.reports = removeDuplicateElements(parsedReports.filter(Boolean));
    state.excludedModelKeys.clear();
    renderPage();
}

function selectScenario(scenarioKey) {
    if (scenarioKey === state.activeScenarioKey) return;
    state.activeScenarioKey = scenarioKey;
    renderPage();
}

function setModelIncluded(modelName, isIncluded) {
    const modelKey = getModelKey(modelName);
    if (isIncluded) state.excludedModelKeys.delete(modelKey);
    else state.excludedModelKeys.add(modelKey);
    renderStatistics();
}

/** Прокручивает к карточке категории и на короткое время выделяет её рамкой. */
function showCategoryCard(categoryIndex) {
    const card = document.getElementById(getCategoryCardId(categoryIndex));
    if (!card) return;

    const previousCard = dom.categoryCards.querySelector('.detail--selected');
    if (previousCard) previousCard.classList.remove('detail--selected');
    card.classList.add('detail--selected');

    clearTimeout(highlightTimerId);
    highlightTimerId = setTimeout(() => card.classList.remove('detail--selected'), HIGHLIGHT_DURATION_MS);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ============================================================
   7. Выгрузка в PDF
   ============================================================ */

/**
 * html2canvas рисует <svg> через сериализацию, и правила из style.css внутрь SVG
 * не попадают — поэтому вычисленные стили вписываются в сами элементы копии страницы.
 */
function inlineSvgStyles(targetDocument) {
    const view = targetDocument.defaultView;
    for (const svgNode of targetDocument.querySelectorAll('svg, svg *')) {
        const computedStyle = view.getComputedStyle(svgNode);
        for (const property of SVG_STYLE_PROPERTIES) {
            svgNode.style.setProperty(property, computedStyle.getPropertyValue(property));
        }
    }
}

function formatDateForFileName(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return day + '-' + month + '-' + date.getFullYear();
}

/**
 * Снимок всей страницы (html2canvas) кладётся на одну страницу PDF шириной A4;
 * высота — по пропорциям снимка, чтобы карточки не разрезались между страницами.
 */
async function exportPageToPdf() {
    if (typeof window.html2canvas !== 'function' || !window.jspdf) {
        alert('Не удалось загрузить библиотеки для PDF — проверьте подключение к интернету и обновите страницу.');
        return;
    }

    const button = dom.exportPdfButton;
    const buttonText = button.textContent;
    button.disabled = true;
    button.textContent = 'Формирование PDF...';
    try {
        const canvas = await window.html2canvas(document.querySelector('.page'), {
            scale: PDF_RENDER_SCALE,
            backgroundColor: getComputedStyle(document.body).backgroundColor,
            ignoreElements: node => node.classList && node.classList.contains('no-print'),
            onclone: clonedDocument => {
                // в копии страница раскрывается на всю высоту, без внутренней прокрутки
                clonedDocument.documentElement.classList.add('pdf-mode');
                inlineSvgStyles(clonedDocument);
            }
        });

        const pageHeightMm = canvas.height * PDF_PAGE_WIDTH_MM / canvas.width;
        const pdf = new window.jspdf.jsPDF({
            orientation: PDF_PAGE_WIDTH_MM >= pageHeightMm ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [PDF_PAGE_WIDTH_MM, pageHeightMm]
        });
        pdf.addImage(canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY), 'JPEG', 0, 0, PDF_PAGE_WIDTH_MM, pageHeightMm);
        pdf.save('Дашборд_МССК_Сценарий_' + state.activeScenarioKey + '_' + formatDateForFileName(new Date()) + '.pdf');
    } catch (error) {
        console.error('Не удалось сформировать PDF:', error);
        alert('Не удалось сформировать PDF — подробности в консоли (F12).');
    } finally {
        button.textContent = buttonText;
        button.disabled = false;
    }
}

/* ============================================================
   8. Запуск
   Обработчики вешаются по одному на блок (делегирование), а не на каждую строку и столбец.
   ============================================================ */

function bindEvents() {
    dom.chooseFolderButton.addEventListener('click', () => dom.folderInput.click());
    dom.folderInput.addEventListener('change', () => {
        if (dom.folderInput.files.length > 0) loadReportsFromFolder(dom.folderInput.files);
        dom.folderInput.value = ''; // чтобы повторный выбор той же папки тоже сработал
    });
    dom.exportPdfButton.addEventListener('click', exportPageToPdf);

    dom.scenarioTabs.addEventListener('click', event => {
        const tab = event.target.closest('.tab');
        if (tab) selectScenario(tab.dataset.scenarioKey);
    });

    dom.registryList.addEventListener('change', event => {
        const checkbox = event.target;
        if (checkbox.dataset.modelName !== undefined) setModelIncluded(checkbox.dataset.modelName, checkbox.checked);
    });

    dom.barChart.addEventListener('click', event => {
        const bar = event.target.closest('.chart__bar');
        if (bar) showCategoryCard(Number(bar.dataset.categoryIndex));
    });

    dom.content.addEventListener('scroll', () => {
        const isScrolledDown = dom.content.scrollTop > dom.content.clientHeight * TO_TOP_SCROLL_RATIO;
        dom.toTopButton.classList.toggle('to-top--visible', isScrolledDown);
    }, { passive: true });
    dom.toTopButton.addEventListener('click', () => dom.content.scrollTo({ top: 0, behavior: 'smooth' }));}

renderScenarioTabs();
bindEvents();
renderPage();