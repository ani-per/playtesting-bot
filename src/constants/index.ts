export const TOSSUP_REGEX = /(.*)\nANSWER:(.*)(?:\n?.*?\n<(.*)>)?/;
export const BONUS_REGEX = /(.+)\n(.+)\nANSWER:(.+)\n(.+)\nANSWER:(.+)\n(.+)\nANSWER:(.+)(?=(?:[\s\S]*?<([^>\r\n]*)>)|[\s\S]*$)(?=(?:[\s\S]*?\|\|([emh])\/([emh])\/([emh])\|\|)|[\s\S]*$)[\s\S]*$/;

export const BONUS_DIFFICULTY_REGEX = /.*\[10(?:\|\|)?(\w{1})(?:\|\|)?\].*/;
export const SECRET_ROLE = "secret";

export const CATEGORY = 'category';
export const AUTHOR = 'author';

export const asyncCharLimit = 60;
export const bulkCharLimit = 35;

export const ASYNC_CHANNEL = 1;
export const BULK_CHANNEL = 2;
export const ECHO_CHANNEL = 3;