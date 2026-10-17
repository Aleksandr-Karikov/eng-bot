-- Все участники живут в Новосибирске; новых пользователей этот пояс получает в коде (services/users.ts).
UPDATE `users` SET `timezone` = 'Asia/Novosibirsk' WHERE `timezone` = 'Europe/Moscow';
