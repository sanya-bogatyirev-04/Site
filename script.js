'use strict';

/* ============================================================
   Справочники
   ============================================================ */

const SCENARIOS = [
    { key: 'А', title: 'Сценарий А' },
    { key: 'Б', title: 'Сценарий Б' },
    { key: 'В', title: 'Сценарий В' },
    { key: 'Г', title: 'Сценарий Г' }
];

// Варианты = узлы <scenario key="..."> xml-отчёта
const VARIANTS = [
    { key: 'match_above',    title: 'Вариант 1', note: '(совпадает / > 92%)' },
    { key: 'mismatch_above', title: 'Вариант 2', note: '(не совпадает / > 92%)' },
    { key: 'match_below',    title: 'Вариант 3', note: '(совпадает / < 92%)' },
    { key: 'mismatch_below', title: 'Вариант 4', note: '(не совпадает / < 92%)' }
];

const CATEGORIES = [
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

const THRESHOLD = 92;
const HIGHLIGHT_MS = 1500;
let highlightTimer = null;
const Y_TICKS = [100, THRESHOLD, 75, 50, 25];

/* ============================================================
   Данные и расчёты
   Источник — xml-отчёт по решениям оператора (корень <msskReport>).
   Правила подсчёта собраны здесь: чтобы изменить формулу, достаточно
   поправить calcVariantStats / calcCategoryStats.
   ============================================================ */

const OTHER_CATEGORY = { name: 'Иное', code: 'ЭЛ ХХ ХХ ХХ' };

/** Возвращает до `limit` самых частых ключей счётчика Map<string, number>. */
function topKeys(counter, limit) {
    return Array.from(counter.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
        .slice(0, limit)
        .map(entry => entry[0]);
}

function increment(counter, key) {
    counter.set(key, (counter.get(key) || 0) + 1);
}

function percentOf(part, total) {
    return total > 0 ? Math.round(part / total * 100) : 0;
}

const DataService = {

    /**
     * Определяет сценарий (А/Б/В/Г), к которому относится файл, по имени:
     * буква сразу после номера модели («Сколтех_5А_...», «Модель 1.А.xml»)
     * либо отдельная буква перед расширением («..._Б.xml»).
     * Если буквы нет — файл показывается во всех сценариях (возвращается null).
     * @param {string} fileName
     * @returns {string|null}
     */
    detectScenario(fileName) {
        const match = fileName.match(/\d[._\s]?([АБВГ])(?![А-Яа-яЁё])/)
            || fileName.match(/[._\s]([АБВГ])\.[^.]+$/);
        return match ? match[1] : null;
    },

    /**
     * Разбирает текст xml-отчёта (msskReport) в плоский список элементов.
     * Бросает Error, если файл не xml или это отчёт другого формата.
     * @param {string} xmlText
     * @returns {Array<{variant: string, changed: boolean, decision: string,
     *                  agent: {code: string, name: string}, operator: {code: string, name: string}}>}
     *          changed = false — оператор согласился с агентом (true в заметках),
     *          changed = true  — снял галку либо выбрал ТОП-2/ТОП-3 (false в заметках)
     */
    parseReportXml(xmlText) {
        const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (xml.querySelector('parsererror')) {
            throw new Error('Файл повреждён или не является xml');
        }
        const root = xml.documentElement;
        if (root.nodeName !== 'msskReport') {
            throw new Error('Не отчёт по решениям оператора (корневой узел <' + root.nodeName + '>, ожидается <msskReport>)');
        }

        const value = (element, tag) => {
            const node = element.querySelector(':scope > ' + tag);
            return {
                code: node ? (node.getAttribute('code') || '').trim() : '',
                name: node ? (node.getAttribute('name') || '').trim() : ''
            };
        };

        const elements = [];
        root.querySelectorAll(':scope > scenarios > scenario').forEach(scenario => {
            const variant = scenario.getAttribute('key');
            scenario.querySelectorAll(':scope > elements > element').forEach(element => {
                elements.push({
                    variant: variant,
                    changed: element.getAttribute('changed') === 'true',
                    decision: element.getAttribute('decision') || '',
                    agent: value(element, 'agentValue'),
                    operator: value(element, 'operatorValue')
                });
            });
        });
        return elements;
    },

    /**
     * Категория элемента = его верный класс:
     *   оператор согласился с агентом — класс агента (agentValue);
     *   оператор не согласился        — класс, который утвердил оператор (operatorValue):
     *                                   выбранный ТОП-2/ТОП-3 либо старое значение элемента.
     * Если оператор снял галку, а старое значение пустое, верный класс неизвестен —
     * тогда ошибка записывается на класс, который предложил агент.
     * «Иное» — только элементы, где и агент не распознал класс («Unknown»).
     */
    categoryOf(element) {
        const candidates = element.changed ? [element.operator, element.agent] : [element.agent];
        const source = candidates.find(candidate => this.isKnownClass(candidate.name));
        if (!source) return OTHER_CATEGORY;
        return { name: source.name, code: source.code.replace(/^\((.*)\)$/, '$1') };
    },

    isKnownClass(name) {
        return Boolean(name) && !/^unknown$/i.test(name);
    },

    /**
     * Блок «Распределение по вариантам».
     *   всего экземпляров — число элементов в узле <scenario key="...">;
     *   допущено ошибок   — элементы, где оператор не согласился с агентом (changed="true");
     *   точность          — доля элементов без ошибки, %;
     *   топ-3 проблемных  — категории, в которых больше всего ошибок.
     * @param {Array<Object>} elements
     * @returns {Object<string, {accuracy: number, total: number, errors: number, topProblemClasses: string[]}>}
     *          ключ — VARIANTS[i].key
     */
    calcVariantStats(elements) {
        const stats = {};
        for (const variant of VARIANTS) {
            const own = elements.filter(element => element.variant === variant.key);
            const problems = new Map();
            let errors = 0;
            for (const element of own) {
                if (!element.changed) continue;
                errors++;
                increment(problems, this.categoryOf(element).name);
            }
            stats[variant.key] = {
                accuracy: percentOf(own.length - errors, own.length),
                total: own.length,
                errors: errors,
                topProblemClasses: topKeys(problems, 3)
            };
        }
        return stats;
    },

    /**
     * Блоки «Общая статистика» и «Детализация статистики» — показатели по каждой
     * категории (см. categoryOf) по всем четырём вариантам, по убыванию процента.
     *   всего экземпляров  — подтверждённые предсказания этой категории
     *                        + исправленные оператором на эту категорию;
     *   ошибки             — вторая часть (исправленные);
     *   процент            — доля подтверждённых от «всего»;
     *   топ-3 предложенных — с какими классами агент чаще всего путал эту категорию.
     *                        Считается по ошибкам, где известны оба класса (агента и верный),
     *                        в обе стороны: агент назвал элемент категории другим классом
     *                        либо назвал этой категорией элемент другого класса.
     * @param {Array<Object>} elements
     * @returns {Array<{name: string, code: string, percent: number, total: number, topSuggestedClasses: string[]}>}
     */
    calcCategoryStats(elements) {
        const groups = new Map();
        for (const element of elements) {
            const category = this.categoryOf(element);
            const key = category.code + '|' + category.name;
            if (!groups.has(key)) {
                groups.set(key, { name: category.name, code: category.code, total: 0, confirmed: 0, suggested: new Map() });
            }
            const group = groups.get(key);
            group.total++;
            if (!element.changed) group.confirmed++;
        }

        // путаница классов: пара «класс агента ↔ верный класс» засчитывается обеим категориям
        const byName = new Map(Array.from(groups.values()).map(group => [group.name, group]));
        for (const element of elements) {
            const predicted = element.agent.name;
            const correct = element.operator.name;
            if (!element.changed || !this.isKnownClass(predicted) || !this.isKnownClass(correct) || predicted === correct) continue;
            if (byName.has(correct)) increment(byName.get(correct).suggested, predicted);
            if (byName.has(predicted)) increment(byName.get(predicted).suggested, correct);
        }

        return Array.from(groups.values())
            .map(group => ({
                name: group.name,
                code: group.code,
                percent: percentOf(group.confirmed, group.total),
                total: group.total,
                topSuggestedClasses: topKeys(group.suggested, 3)
            }))
            .sort((a, b) => b.percent - a.percent || b.total - a.total || a.name.localeCompare(b.name, 'ru'));
    }
};

/* ============================================================
   Состояние
   ============================================================ */

const state = {
    scenario: SCENARIOS[0].key,
    folderChosen: false,
    registry: [] // { name, scenario, checked, elements, error }
};

const dom = {
    tabs: document.getElementById('scenarioTabs'),
    chooseFolderBtn: document.getElementById('chooseFolderBtn'),
    folderInput: document.getElementById('folderInput'),
    exportPdfBtn: document.getElementById('exportPdfBtn'),
    registryList: document.getElementById('registryList'),
    content: document.getElementById('content'),
    toTopBtn: document.getElementById('toTopBtn'),
    variants: document.getElementById('variants'),
    chart: document.getElementById('chart'),
    details: document.getElementById('details')
};

/* ============================================================
   Вспомогательное
   ============================================================ */

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function formatCount(value) {
    return value === null || value === undefined ? 'шт' : value.toLocaleString('ru-RU') + ' шт';
}

function visibleRegistry() {
    return state.registry.filter(item => item.scenario === null || item.scenario === state.scenario);
}

/* ============================================================
   Отрисовка
   ============================================================ */

function renderTabs() {
    dom.tabs.replaceChildren(...SCENARIOS.map(scenario => {
        const tab = el('button', 'tab' + (scenario.key === state.scenario ? ' tab--active' : ''), scenario.title);
        tab.type = 'button';
        tab.addEventListener('click', () => {
            state.scenario = scenario.key;
            refresh();
        });
        return tab;
    }));
}

function renderRegistry() {
    const items = visibleRegistry();

    if (items.length === 0) {
        const placeholder = el('li', 'registry__item registry__item--placeholder');
        const box = el('input', 'registry__check');
        box.type = 'checkbox';
        box.disabled = true;
        placeholder.append(box, el('span', 'registry__box'), el('span', 'registry__name', state.folderChosen ? 'Нет файлов .xml' : 'Выберите папку'));
        dom.registryList.replaceChildren(placeholder);
        return;
    }

    dom.registryList.replaceChildren(...items.map(item => {
        const row = el('li');
        const label = el('label', 'registry__item' + (item.error ? ' registry__item--placeholder' : ''));
        label.title = item.error ? item.name + ' — ' + item.error : item.name;
        const box = el('input', 'registry__check');
        box.type = 'checkbox';
        box.checked = item.checked;
        box.disabled = Boolean(item.error);
        box.addEventListener('change', () => {
            item.checked = box.checked;
            updateDashboard();
        });
        label.append(box, el('span', 'registry__box'), el('span', 'registry__name', item.name));
        row.append(label);
        return row;
    }));
}

function renderStatList(parent, label, values) {
    parent.append(el('p', 'stat__label', label));
    for (let i = 0; i < 3; i++) {
        const value = values && values[i];
        parent.append(el('p', 'stat__item' + (value ? '' : ' stat__item--empty'), value ? '- ' + value : '-'));
    }
}

function renderVariants(stats) {
    dom.variants.replaceChildren(...VARIANTS.map(variant => {
        const data = stats ? stats[variant.key] : null;
        const card = el('article', 'variant');

        const head = el('div', 'variant__head');
        const title = el('div', 'variant__title', variant.title);
        title.append(el('span', 'variant__note', variant.note));
        const accuracy = el('div', 'variant__accuracy', (data ? data.accuracy : 0) + '%');
        accuracy.append(el('span', 'variant__note', 'точность'));
        head.append(title, accuracy);

        card.append(
            head,
            el('p', 'stat__label', 'Всего экземпляров:'),
            el('p', 'stat__value', formatCount(data && data.total)),
            el('p', 'stat__label', 'Допущено ошибок:'),
            el('p', 'stat__value', formatCount(data && data.errors))
        );
        renderStatList(card, 'Топ-3 проблемных класса:', data && data.topProblemClasses);
        return card;
    }));
}

function renderChart(categories) {
    const plot = el('div', 'chart__plot');

    for (const tick of Y_TICKS) {
        const label = el('span', 'chart__tick', String(tick));
        label.style.bottom = tick + '%';
        plot.append(label);
    }
    const threshold = el('div', 'chart__threshold');
    threshold.style.bottom = THRESHOLD + '%';
    plot.append(threshold);

    const bars = el('div', 'chart__bars');
    const labels = el('div', 'chart__labels');
    const hasData = Boolean(categories && categories.length);
    const axis = hasData ? categories : CATEGORIES;

    axis.forEach((category, index) => {
        const slot = el('div', 'chart__slot');
        if (hasData) {
            const bar = el('div', 'chart__bar');
            bar.style.height = category.percent + '%';
            bar.dataset.value = category.percent;
            bar.addEventListener('click', () => {
                const card = document.getElementById('detail-' + index);
                if (!card) return;
                // выбранная категория выделяется рамкой на 3 секунды
                dom.details.querySelectorAll('.detail--selected').forEach(node => node.classList.remove('detail--selected'));
                card.classList.add('detail--selected');
                clearTimeout(highlightTimer);
                highlightTimer = setTimeout(() => card.classList.remove('detail--selected'), HIGHLIGHT_MS);
                card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            slot.append(bar);
        }
        bars.append(slot);

        const label = el('div', 'chart__label');
        const text = el('span', 'chart__label-text');
        text.append(el('span', 'chart__label-name', category.name), el('span', 'chart__label-code', category.code));
        label.append(text);
        labels.append(label);
    });

    plot.append(bars);
    dom.chart.replaceChildren(plot, labels);
}

function createDonut(percent) {
    const NS = 'http://www.w3.org/2000/svg';
    const radius = 49.7;
    const length = 2 * Math.PI * radius;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'donut');
    svg.setAttribute('viewBox', '0 0 120 120');

    const circle = (className) => {
        const node = document.createElementNS(NS, 'circle');
        node.setAttribute('class', className);
        node.setAttribute('cx', 60);
        node.setAttribute('cy', 60);
        node.setAttribute('r', radius);
        node.setAttribute('stroke-width', 20.6);
        return node;
    };

    const value = circle('donut__value');
    value.setAttribute('stroke-dasharray', (length * percent / 100) + ' ' + length);
    // заливка идёт от «3 часов» по часовой стрелке

    const text = document.createElementNS(NS, 'text');
    text.setAttribute('class', 'donut__text');
    text.setAttribute('x', 60);
    text.setAttribute('y', 60);
    text.textContent = percent + '%';

    svg.append(circle('donut__track'), value, text);
    return svg;
}

function renderDetails(categories) {
    const placeholder = { name: 'Категория элемента', code: 'ЭЛ ХХ ХХ ХХ', percent: 0, total: null, topSuggestedClasses: null };
    const list = categories && categories.length ? categories : [placeholder, placeholder];

    dom.details.replaceChildren(...list.map((category, index) => {
        const card = el('article', 'detail');
        card.id = 'detail-' + index;

        const info = el('div', 'detail__info');
        info.append(
            el('h3', 'detail__title', category.name),
            el('p', 'detail__code', category.code),
            el('p', 'stat__label', 'Всего экземпляров:'),
            el('p', 'stat__value', formatCount(category.total))
        );
        renderStatList(info, 'Топ-3 предложенных класса:', category.topSuggestedClasses);

        card.append(info, createDonut(category.percent));
        return card;
    }));
}

/* ============================================================
   Обновление страницы
   ============================================================ */

function updateDashboard() {
    const selected = visibleRegistry().filter(item => item.checked && !item.error);

    if (selected.length === 0) {
        renderVariants(null);
        renderChart(null);
        renderDetails(null);
        return;
    }

    const elements = selected.flatMap(item => item.elements);
    const categories = DataService.calcCategoryStats(elements);
    renderVariants(DataService.calcVariantStats(elements));
    renderChart(categories);
    renderDetails(categories);
}

function refresh() {
    dom.chooseFolderBtn.textContent = state.folderChosen ? 'Изменить папку' : 'Выбрать папку';
    renderTabs();
    renderRegistry();
    updateDashboard();
}

/* ============================================================
   Действия пользователя
   ============================================================ */

let folderToken = 0;

/** Читает и разбирает все xml из выбранной папки; файлы другого формата помечаются в реестре как нечитаемые. */
async function onFolderChosen(fileList) {
    const token = ++folderToken;
    const files = Array.from(fileList)
        .filter(file => /\.xml$/i.test(file.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    const registry = await Promise.all(files.map(async file => {
        const item = { name: file.name, scenario: DataService.detectScenario(file.name), checked: true, elements: [], error: null };
        try {
            item.elements = DataService.parseReportXml(await file.text());
        } catch (error) {
            console.warn('Файл пропущен: ' + file.name + ' — ' + error.message);
            item.error = error.message;
            item.checked = false;
        }
        return item;
    }));
    if (token !== folderToken) return; // пока читали, выбрали другую папку

    state.folderChosen = true;
    state.registry = registry;
    refresh();
}

/**
 * html2canvas рисует <svg> через сериализацию, и правила из style.css внутрь
 * SVG не попадают — поэтому переносим вычисленные стили в атрибут style
 * каждого элемента SVG в копии страницы
 */
function inlineSvgStyles(targetDocument) {
    const view = targetDocument.defaultView;
    const properties = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size',
        'font-weight', 'text-anchor', 'dominant-baseline'];
    targetDocument.querySelectorAll('svg, svg *').forEach((element) => {
        const computed = view.getComputedStyle(element);
        properties.forEach((property) => {
            element.style.setProperty(property, computed.getPropertyValue(property));
        });
    });
}

/**
 * Выгрузка страницы в PDF: снимок всей страницы (html2canvas) кладётся на одну
 * страницу шириной A4, высота — по пропорциям снимка, чтобы карточки не разрезались.
 */
async function exportToPdf() {
    if (typeof window.html2canvas !== 'function' || !window.jspdf) {
        alert('Не удалось загрузить библиотеки для PDF — проверьте подключение к интернету и обновите страницу.');
        return;
    }

    const button = dom.exportPdfBtn;
    button.disabled = true;
    button.textContent = 'Формирование PDF...';
    try {
        const canvas = await window.html2canvas(document.querySelector('.page'), {
            scale: 2,
            backgroundColor: getComputedStyle(document.body).backgroundColor,
            ignoreElements: (element) => element.classList && element.classList.contains('no-print'),
            onclone: (clonedDocument) => {
                // в копии страница раскрывается на всю высоту, без внутренней прокрутки
                clonedDocument.documentElement.classList.add('pdf-mode');
                inlineSvgStyles(clonedDocument);
            }
        });

        const pageWidth = 297;
        const pageHeight = canvas.height * pageWidth / canvas.width;
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [pageWidth, pageHeight]
        });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidth, pageHeight);

        const today = new Date();
        const dateKey = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
        pdf.save(`Дашборд_МССК_Сценарий_${state.scenario}_${dateKey}.pdf`);
    } catch (error) {
        console.error('Не удалось сформировать PDF:', error);
        alert('Не удалось сформировать PDF — подробности в консоли (F12).');
    } finally {
        button.textContent = 'Выгрузить в PDF';
        button.disabled = false;
    }
}

dom.chooseFolderBtn.addEventListener('click', () => dom.folderInput.click());
dom.folderInput.addEventListener('change', () => {
    if (dom.folderInput.files.length > 0) onFolderChosen(dom.folderInput.files);
    dom.folderInput.value = '';
});
dom.exportPdfBtn.addEventListener('click', exportToPdf);

// стрелка «наверх» появляется, когда пользователь ушёл вниз больше чем на половину экрана
dom.content.addEventListener('scroll', () => {
    dom.toTopBtn.classList.toggle('to-top--visible', dom.content.scrollTop > dom.content.clientHeight * 0.5);
}, { passive: true });
dom.toTopBtn.addEventListener('click', () => dom.content.scrollTo({ top: 0, behavior: 'smooth' }));

refresh();
