function injectScriptAutoTrainerPaladin() {
    if (settings_cookies.general['show__auto_paladin_train'].enabled === true) {
        runAutoTrainer();
    }
}

async function runAutoTrainer() {
    const isWaiting = localStorage.getItem('function_auto_trainer_paladin');
    const cancelButton = document.querySelector('.knight_train_abort');
    const showWarningPopup = !isWaiting && !cancelButton;

    const userChoice = showWarningPopup ? await displayWarningPopup('Confirm Auto Paladin Train', 'Do you wish to continue with the paladin train automation?') : 'cancel';

    if (userChoice === 'cancel') {
        return;
    } else {
        var maxPaladinLevel = settings_cookies.general['show__auto_paladin_train']['maxLevel']; //train until X level
        var currentPaladinLevel = document.querySelector('.level').textContent;

        var trainStartButton = document.querySelector('.knight_train_launch');
        if (trainStartButton && (maxPaladinLevel !== currentPaladinLevel)) {
            trainStartButton.click();
            wait(1).then(() => {
                var trainLevelsButtons = document.querySelectorAll('.btn.knight_regimen_confirm:not([class*="btn-pp"])');
                var trainLevel = 0;
                if (trainLevelsButtons.length) {
                    trainLevelsButtons[trainLevel].click();

                    wait(1).then(() => {
                        var trainTime = document.querySelector('[data-endtime]');
                        if (trainTime) {
                            var waitTime = timeToMilliseconds(trainTime.textContent);

                            if (waitTime > 0) {
                                setFunctionOnTimeOut('auto_trainer_paladin', function () {
                                    window.location.href = game_data.link_base_pure + 'statue';
                                }, waitTime);
                            }
                        }
                    })
                }
            });

        } else {
            var trainTime = document.querySelector('[data-endtime]');
            if (trainTime) {
                var waitTime = timeToMilliseconds(trainTime.textContent);

                if (waitTime > 0) {
                    setFunctionOnTimeOut('auto_trainer_paladin', function () {
                        window.location.href = game_data.link_base_pure + 'statue';
                    }, waitTime);
                }
            }
        }
    }
}