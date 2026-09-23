/**
 * Fetches the simulator page in the background and logs the benefit definitions.
 * The response is parsed as data only; no simulator scripts are executed.
 */
var _benefitPossibilitiesFetchStarted = false;

function injectBenefitPossibilitiesFetcher() {
    if (_benefitPossibilitiesFetchStarted || typeof game_data === 'undefined' || !game_data.village?.id) return;
    _benefitPossibilitiesFetchStarted = true;

    var world = String(game_data.world || window.location.hostname);
    var villageId = game_data.village.id;
    var url = getVillageLinkBase(villageId) + 'place&mode=sim';

    getBenefitPossibilities(world)
        .then(function (cached) {
            if (isValidBenefitPossibilities(cached)) {
                logBenefitPossibilities(cached, 'cache');
                return null;
            }

            return fetchPageOnce('sim-benefit-possibilities:' + world, url)
                .then(parseBenefitPossibilities)
                .then(function (possibilities) {
                    if (!isValidBenefitPossibilities(possibilities)) {
                        throw new Error('No complete benefit possibilities were found');
                    }
                    return storeBenefitPossibilities(world, possibilities).then(function () {
                        logBenefitPossibilities(possibilities, 'fetch');
                    });
                });
        })
        .catch(function (error) {
            console.warn('[Premium Features] Could not read simulator benefit possibilities:', error);
        });
}

function isValidBenefitPossibilities(possibilities) {
    return Boolean(possibilities && Array.isArray(possibilities.attacker) && possibilities.attacker.length
        && Array.isArray(possibilities.defender) && possibilities.defender.length);
}

function logBenefitPossibilities(possibilities, source) {
    var summary = ['attacker', 'defender'].reduce(function (rows, side) {
        return rows.concat(possibilities[side].map(function (benefit, index) {
            return {
                side: side,
                index: index,
                type: benefit.type,
                name: benefit.name,
                inputs: benefit.inputs
            };
        }));
    }, []);

    console.log('[Premium Features] Simulator benefit possibilities (' + source + '):', possibilities);
    console.table(summary);
}

function parseBenefitPossibilities(html) {
    var documentFromHtml = new DOMParser().parseFromString(html, 'text/html');
    var possibilities = { attacker: [], defender: [] };
    var foundCalls = 0;
    var diagnosticScripts = [];

    Array.prototype.forEach.call(documentFromHtml.querySelectorAll('script'), function (script) {
        var source = script.textContent || '';
        var lowerSource = source.toLowerCase();
        if (/(simulator|benefit|possibil|simulador)/i.test(source)) {
            diagnosticScripts.push({
                src: script.getAttribute('src') || '(inline)',
                matches: ['simulator', 'benefit', 'possibil', 'simulador'].filter(function (term) {
                    return lowerSource.indexOf(term) !== -1;
                }),
                preview: source.replace(/\s+/g, ' ').slice(0, 500)
            });
        }
        var searchFrom = 0;
        var marker = 'addPossibilities';
        var markerIndex;

        while ((markerIndex = source.indexOf(marker, searchFrom)) !== -1) {
            var callStart = source.indexOf('(', markerIndex + marker.length);
            var payloadStart = callStart === -1 ? -1 : findPayloadStart(source, callStart + 1);
            if (payloadStart === -1) break;

            var payloadEnd = source[payloadStart] === '['
                ? findMatchingDelimiter(source, payloadStart, '[', ']')
                : findMatchingDelimiter(source, payloadStart, '{', '}');
            if (payloadEnd === -1) {
                console.warn('[Premium Features] Unclosed benefit possibilities payload:', source.slice(payloadStart, payloadStart + 200));
                break;
            }

            var callTail = source.slice(payloadEnd + 1, payloadEnd + 250);
            var sideMatch = callTail.match(/^\s*,\s*(?:(?:['"])?(attacker|defender)(?:['"])?|Simulator\.SIDE_(ATTACKER|DEFENDER))/);
            var side = sideMatch && (sideMatch[1] || sideMatch[2].toLowerCase());
            var payloadSource = source.slice(payloadStart, payloadEnd + 1);

            if (side) {
                foundCalls++;
                try {
                    var parsed = JSON.parse(payloadSource);
                    var entries = Array.isArray(parsed) ? parsed : Object.keys(parsed).map(function (key) {
                        return parsed[key];
                    });
                    possibilities[side] = possibilities[side].concat(entries);
                } catch (error) {
                    console.warn('[Premium Features] Benefit possibilities payload is not JSON:', {
                        side: side,
                        error: error.message,
                        payload: payloadSource
                    });
                }
            } else {
                console.warn('[Premium Features] Could not identify benefit side:', {
                    payload: payloadSource.slice(0, 200),
                    callTail: callTail
                });
            }

            searchFrom = payloadEnd + 1;
        }
    });

    if (!foundCalls) {
        console.warn('[Premium Features] No Simulator.BenefitCreator.addPossibilities call found in simulator HTML.', {
            htmlLength: html.length,
            title: documentFromHtml.title,
            scriptCount: documentFromHtml.scripts.length,
            bodyPreview: (documentFromHtml.body && documentFromHtml.body.textContent || '').replace(/\s+/g, ' ').slice(0, 300),
            relevantScripts: diagnosticScripts
        });
    }

    return possibilities;
}

function findPayloadStart(source, start) {
    for (var index = start; index < source.length; index++) {
        if (!/\s/.test(source[index])) return source[index] === '[' || source[index] === '{' ? index : -1;
    }
    return -1;
}

function findMatchingDelimiter(source, start, opening, closing) {
    var depth = 0;
    var quote = null;
    var escaped = false;

    for (var index = start; index < source.length; index++) {
        var character = source[index];

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === quote) {
                quote = null;
            }
            continue;
        }

        if (character === '"' || character === "'") {
            quote = character;
        } else if (character === opening) {
            depth++;
        } else if (character === closing && --depth === 0) {
            return index;
        }
    }

    return -1;
}
