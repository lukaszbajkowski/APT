"""Sprawdzone tłumaczenia najważniejszych słów aplikacji (pierwszeństwo przed Google).

Google tłumaczy każdy napis osobno, bez kontekstu – krótkie etykiety bywają dwuznaczne („Język” → „tongue”,
„Kadry” → „frames”, „Brak” → po rosyjsku „брак” = małżeństwo / wada). Tu są wersje sprawdzone w kontekście
aplikacji kadrowej. Klucz to dokładny polski tekst z kodu (`t("…")`). Poprawka administratora na ekranie
„Tłumaczenia” ma pierwszeństwo przed tym słownikiem.
"""

# polski tekst: (ukraiński, rosyjski, angielski)
_ROWS: dict[str, tuple[str, str, str]] = {
    # nawigacja i konto
    "Moje konto": ("Мій акаунт", "Мой аккаунт", "My account"),
    "Moje dane": ("Мої дані", "Мои данные", "My details"),
    "Do podpisu": ("На підпис", "На подпись", "To sign"),
    "Komunikaty": ("Оголошення", "Объявления", "Announcements"),
    "Komunikat": ("Оголошення", "Объявление", "Announcement"),
    "Wiadomości": ("Повідомлення", "Сообщения", "Messages"),
    "Nowa wiadomość": ("Нове повідомлення", "Новое сообщение", "New message"),
    "Kadry": ("Відділ кадрів", "Отдел кадров", "HR"),
    "Napisz do kadr": ("Написати до відділу кадрів", "Написать в отдел кадров", "Message HR"),
    "Więcej": ("Більше", "Ещё", "More"),
    "Wyloguj": ("Вийти", "Выйти", "Sign out"),
    "Logowanie i powiadomienia": ("Вхід і сповіщення", "Вход и уведомления", "Sign-in & notifications"),
    "Pomoc i prywatność": ("Допомога і конфіденційність", "Помощь и конфиденциальность", "Help & privacy"),
    "Język": ("Мова", "Язык", "Language"),
    "Język aplikacji": ("Мова застосунку", "Язык приложения", "App language"),
    "Motyw": ("Тема", "Тема", "Theme"),
    "Jasny": ("Світла", "Светлая", "Light"),
    "Ciemny": ("Темна", "Тёмная", "Dark"),
    "System": ("Як у системі", "Как в системе", "System"),
    "Strona główna": ("Головна", "Главная", "Home"),
    # logowanie
    "Login": ("Логін", "Логин", "Username"),
    "Hasło": ("Пароль", "Пароль", "Password"),
    "Zaloguj": ("Увійти", "Войти", "Sign in"),
    "Zaloguj kluczem dostępu": ("Увійти з ключем доступу", "Войти с ключом доступа", "Sign in with a passkey"),
    "Użyj klucza z innego urządzenia": (
        "Використати ключ з іншого пристрою",
        "Использовать ключ с другого устройства",
        "Use a passkey from another device",
    ),
    "Kod z aplikacji": ("Код із застосунку", "Код из приложения", "Code from the app"),
    "Dodaj klucz": ("Додати ключ", "Добавить ключ", "Add passkey"),
    "Twoje klucze": ("Ваші ключі", "Ваши ключи", "Your passkeys"),
    "Dodaj inne urządzenie": ("Додати інший пристрій", "Добавить другое устройство", "Add another device"),
    # dane pracownika
    "Data urodzenia": ("Дата народження", "Дата рождения", "Date of birth"),
    "Telefon": ("Телефон", "Телефон", "Phone"),
    "Numer telefonu": ("Номер телефону", "Номер телефона", "Phone number"),
    "Adres e-mail": ("Електронна пошта", "Электронная почта", "Email address"),
    "E-mail": ("Електронна пошта", "Эл. почта", "Email"),
    "Wydział": ("Відділ", "Отдел", "Department"),
    "Stanowisko": ("Посада", "Должность", "Position"),
    "Agencja": ("Агентство", "Агентство", "Agency"),
    "Zatrudnienie": ("Працевлаштування", "Трудоустройство", "Employment"),
    "Zatrudniony od": ("Працює з", "Работает с", "Employed since"),
    "Zdjęcie do karty": ("Фото для картки", "Фото для пропуска", "ID card photo"),
    "Brak": ("Немає", "Нет", "None"),
    "Nie podano": ("Не вказано", "Не указано", "Not provided"),
    "potwierdzony": ("підтверджено", "подтверждён", "verified"),
    "niepotwierdzony": ("не підтверджено", "не подтверждён", "not verified"),
    # dokumenty i podpis
    "Podpis": ("Підпис", "Подпись", "Signature"),
    "Podpisz": ("Підписати", "Подписать", "Sign"),
    "Podpisane": ("Підписані", "Подписанные", "Signed"),
    "Pobierz PDF": ("Завантажити PDF", "Скачать PDF", "Download PDF"),
    "Podgląd dokumentu": ("Перегляд документа", "Просмотр документа", "Document preview"),
    "strony": ("сторінки", "страницы", "pages"),
    "stron": ("сторінок", "страниц", "pages"),
    "1 strona": ("1 сторінка", "1 страница", "1 page"),
    # komunikaty
    "Aktywne": ("Активні", "Активные", "Active"),
    "Archiwum": ("Архів", "Архив", "Archive"),
    "Potwierdzone": ("Підтверджено", "Подтверждено", "Confirmed"),
    "Do potwierdzenia": ("Потрібно підтвердити", "Нужно подтвердить", "Needs confirmation"),
    "Przeczytałem(-am)": ("Я прочитав(-ла)", "Я прочитал(-а)", "I have read it"),
    "Zapoznałem(-am) się": ("Я ознайомився(-лася)", "Я ознакомился(-ась)", "I have read and understood"),
    "Odsłuchaj": ("Прослухати", "Прослушать", "Listen"),
    # przyciski
    "Dalej": ("Далі", "Далее", "Next"),
    "Wstecz": ("Назад", "Назад", "Back"),
    "Wróć": ("Назад", "Назад", "Back"),
    "Anuluj": ("Скасувати", "Отмена", "Cancel"),
    "Zamknij": ("Закрити", "Закрыть", "Close"),
    "Usuń": ("Видалити", "Удалить", "Delete"),
    "Otwórz": ("Відкрити", "Открыть", "Open"),
    "Gotowe": ("Готово", "Готово", "Done"),
    "Potwierdź": ("Підтвердити", "Подтвердить", "Confirm"),
    "Wyślij": ("Надіслати", "Отправить", "Send"),
    "Wyślij kod": ("Надіслати код", "Отправить код", "Send code"),
    "Wybierz": ("Вибрати", "Выбрать", "Choose"),
    # kalendarz i zegar (pola daty i godziny)
    "Dziś": ("Сьогодні", "Сегодня", "Today"),
    "Godzina": ("Година", "Час", "Hour"),
    "Minuty": ("Хвилини", "Минуты", "Minutes"),
    "Poprzedni miesiąc": ("Попередній місяць", "Предыдущий месяц", "Previous month"),
    "Następny miesiąc": ("Наступний місяць", "Следующий месяц", "Next month"),
    "Wybierz godzinę": ("Вибрати час", "Выбрать время", "Choose time"),
    "Wybierz z kalendarza": ("Вибрати в календарі", "Выбрать в календаре", "Choose from calendar"),
    "Godzina 00:00–23:59": ("Час 00:00–23:59", "Время 00:00–23:59", "Time 00:00–23:59"),
    "Data poza dozwolonym zakresem.": ("Дата поза дозволеним діапазоном.", "Дата вне допустимого диапазона.", "Date outside the allowed range."),
    "Nieprawidłowa data – wpisz dzień, miesiąc i rok (np. 05.11.2026).": (
        "Неправильна дата – введіть день, місяць і рік (напр. 05.11.2026).",
        "Неверная дата – введите день, месяц и год (напр. 05.11.2026).",
        "Invalid date – enter day, month and year (e.g. 05.11.2026).",
    ),
    # zaznaczanie („Zaznaczono 4 z 16”)
    "Zaznaczono": ("Вибрано", "Выбрано", "Selected"),
    "z": ("з", "из", "of"),
}

_COL = {"uk": 0, "ru": 1, "en": 2}


def lookup(text: str, lang: str) -> str | None:
    """Sprawdzone tłumaczenie albo None (wtedy decyduje zapamiętane tłumaczenie lub Google)."""
    col = _COL.get(lang.split("-")[0].lower())
    if col is None:
        return None
    row = _ROWS.get(text)
    return row[col] if row else None


def entries(lang: str) -> dict[str, str]:
    col = _COL.get(lang.split("-")[0].lower())
    return {} if col is None else {k: v[col] for k, v in _ROWS.items()}


LANGS = tuple(_COL)
