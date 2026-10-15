// Plugin-owned explanations; clients render these generically without Type policy.
export function wordState(settings,collector){
 if(!settings.recordWords)return 'disabled';
 if(!settings.enabled||!settings.backgroundEnabled)return 'paused';
 if(collector.reason==='permission_denied')return 'permission_denied';
 if(collector.reason==='no_devices')return 'no_devices';
 if(collector.decoder?.reason==='ime_committed_text_unavailable')return 'ime_unavailable';
 if(['unavailable','error','unsupported'].includes(collector.decoder?.state))return 'decoder_unavailable';
 if(collector.words?.bufferedCharacters)return 'waiting_boundary';
 if(collector.words?.committed)return 'ready';
 if(collector.words?.physicalPresses&&!collector.words?.textEvents)return 'no_decoded_text';
 return 'waiting_input';
}
const copy={
 disabled:[['Сбор слов выключен','Включите «Сохранять частотность слов» в настройках Type или кнопкой в уведомлении. Это отдельное согласие: словарь может содержать личные слова. Минимального числа повторов нет.'],['Word collection is off','Enable “Save word frequencies” in Type settings or its notice action. This requires separate consent: dictionaries may contain private words. There is no minimum repeat count.']],
 paused:[['Фоновый сбор приостановлен','Включите сбор статистики и фоновый сбор в настройках Type. Тренажёр и фоновая печать имеют разные фильтры режима.'],['Background collection is paused','Enable collection and background input in Type settings. Trainer and background records have separate mode filters.']],
 permission_denied:[['Нет доступа к клавиатуре','Нажмите «Разрешить доступ к клавиатуре» в уведомлении Type и подтвердите системный запрос на этом узле.'],['Keyboard access denied','Use the Type notice action to allow keyboard access and approve the system dialog on this node.']],
 no_devices:[['Клавиатура не найдена','Type не получает устройства evdev на этом узле. В контейнере нужны переданные устройства ввода.'],['No keyboard found','Type cannot find evdev devices on this node. Containers require passed-through input devices.']],
 decoder_unavailable:[['Нажатия не преобразуются в слова','Декодер раскладки недоступен. Счётчик физических нажатий сам по себе не означает, что Type получает текст. Подробности — в состоянии сбора слов Type.'],['Keystrokes cannot be decoded into words','The layout decoder is unavailable. Physical keystroke counts do not imply decoded text. Check the Type word capture status.']],
 ime_unavailable:[['Этот способ ввода не поддерживает сбор слов','IME не передаёт итоговый текст через физические события клавиатуры. Type не выдаёт черновые нажатия за слова.'],['This input method cannot provide word counts','Committed IME text is not available through physical key events. Type does not count phonetic drafts as words.']],
 waiting_boundary:[['Завершите слово пробелом или Enter','Слово сохраняется с первого употребления после разделителя. Незавершённый ввод не считается готовым словом; пауза сама по себе не превращает его в слово.'],['Finish the word with Space or Enter','A word counts on its first occurrence after a delimiter. An unfinished token is not a completed word; a pause alone does not complete it.']],
 no_decoded_text:[['Нажатия поступают, но текста пока нет','Проверьте адаптер раскладки и метод ввода в состоянии сбора слов Type. Минимального порога повторов нет.'],['Keystrokes arrived, but no text was decoded','Check the layout adapter and input method in Type word capture status. There is no minimum repeat threshold.']],
 waiting_input:[['Ожидание слов с клавиатуры','Наберите слова и завершите последнее пробелом или Enter. Вставка из буфера не является набором. После сохранения виджет обновится автоматически.'],['Waiting for keyboard words','Type words and finish the last one with Space or Enter. Clipboard paste is not typing. The widget refreshes automatically after saving.']],
 ready:[['Нет слов по выбранным фильтрам','Слова распознаются. Проверьте период, язык и режим «Фоновая печать / Тренажёр». Каждое слово учитывается с первого раза.'],['No words match these filters','Words are being decoded. Check the time range, language and background/trainer mode filters. Every word counts from its first occurrence.']]
};
export function wordEmptyState(settings,collector,locale='en'){const state=wordState(settings,collector);const [title,description]=copy[state][locale==='ru'?0:1];return {title,description};}
