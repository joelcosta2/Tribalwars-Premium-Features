const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const localeNames = ['en', 'pt'];
const locales = Object.fromEntries(localeNames.map((locale) => [
    locale,
    JSON.parse(fs.readFileSync(path.join(__dirname, `${locale}.json`), 'utf8'))
]));
const errors = [];

function report(message) {
    errors.push(message);
}

function validateDictionary(locale, dictionary) {
    Object.entries(dictionary).forEach(([key, value]) => {
        if (typeof value !== 'string' || !value.trim()) {
            report(`${locale}.json: invalid or empty value for ${key}`);
        }
    });
}

localeNames.forEach((locale) => validateDictionary(locale, locales[locale]));

const enKeys = Object.keys(locales.en);
const ptKeys = Object.keys(locales.pt);
const allKeys = new Set([...enKeys, ...ptKeys]);
allKeys.forEach((key) => {
    if (!(key in locales.en)) report(`Missing from en.json: ${key}`);
    if (!(key in locales.pt)) report(`Missing from pt.json: ${key}`);
});

if (enKeys.length !== ptKeys.length || enKeys.some((key, index) => key !== ptKeys[index])) {
    report('Locale key order differs between en.json and pt.json');
}

function placeholderNames(text) {
    return [...text.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((match) => match[1]).sort();
}

enKeys.forEach((key) => {
    if (JSON.stringify(placeholderNames(locales.en[key])) !== JSON.stringify(placeholderNames(locales.pt[key]))) {
        report(`Placeholder mismatch between locales for ${key}`);
    }
});

function collectJavaScriptFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (['.git', '_game_source', 'node_modules'].includes(entry.name)) return [];
            return collectJavaScriptFiles(entryPath);
        }
        return /\.js$/.test(entry.name) ? [entryPath] : [];
    });
}

const translationCall = /\bt\(\s*(['"])([^'"]+)\1\s*(?=[,)])/g;
collectJavaScriptFiles(projectRoot).forEach((filePath) => {
    if (path.relative(projectRoot, filePath) === path.join('i18n', 'i18n_utils.js')) return;
    const source = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = translationCall.exec(source)) !== null) {
        const key = match[2];
        if (!(key in locales.en) || !(key in locales.pt)) {
            const line = source.slice(0, match.index).split('\n').length;
            report(`${path.relative(projectRoot, filePath)}:${line}: missing translation for ${key}`);
        }
    }
});

if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
} else {
    console.log(`i18n validation passed: ${enKeys.length} keys in en.json and pt.json`);
}
