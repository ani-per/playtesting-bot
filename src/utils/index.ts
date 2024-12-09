import {
    ActionRowBuilder, BaseMessageOptions, ButtonBuilder, ButtonStyle, Collection, EmbedBuilder,
    Guild, Message, MessageCreateOptions, MessageFlags, TextChannel
} from "discord.js";
import Database from 'better-sqlite3';
import { encrypt } from "./crypto";
import { sum, group, listify } from 'radash'
import { getBonusSummaryData } from "./queries";
import { client } from "src/bot";
import { getEmojiList } from "src/utils/emojis";

const db = new Database('database.db');

export var packetName = "";
export function setPacketName(desiredPacketName: string) {
    packetName = desiredPacketName;
}

export const deleteServerChannelsCommand = db.prepare('DELETE FROM server_channel WHERE server_id = ?');
const insertServerChannelCommand = db.prepare('INSERT INTO server_channel (server_id, channel_id, result_channel_id, channel_type) VALUES (?, ?, ?, ?)');
const getServerChannelsQuery = db.prepare('SELECT * FROM server_channel WHERE server_id = ?');
const insertBuzzCommand = db.prepare('INSERT INTO buzz (server_id, question_id, author_id, user_id, clue_index, characters_revealed, value, answer_given) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insertBonusDirectCommand = db.prepare('INSERT INTO bonus_direct (server_id, question_id, author_id, user_id, part, value, answer_given) VALUES (?, ?, ?, ?, ?, ?, ?)');
const insertTossupCommand = db.prepare('INSERT INTO tossup (question_id, server_id, author_id, total_characters, category, answer) VALUES (?, ?, ?, ?, ?, ?)');
const insertBonusPartCommand = db.prepare('INSERT INTO bonus_part (question_id, part, difficulty, answer) VALUES (?, ?, ?, ?)');
const insertBonusCommand = db.prepare('INSERT INTO bonus (question_id, server_id, author_id, category) VALUES (?, ?, ?, ?)');
const updateTossupThreadCommand = db.prepare('UPDATE tossup SET thread_id = ? WHERE question_id = ?');
const updateBonusThreadCommand = db.prepare('UPDATE bonus SET thread_id = ? WHERE question_id = ?');
const getTossupThreadQuery = db.prepare('SELECT thread_id FROM tossup WHERE question_id = ?');
const getBonusThreadQuery = db.prepare('SELECT thread_id FROM bonus WHERE question_id = ?');
const getTossupBuzzesQuery = db.prepare('SELECT clue_index, value, characters_revealed FROM buzz WHERE question_id = ? ORDER BY clue_index');
const getTossupCategoryCountQuery = db.prepare('SELECT COUNT(*) AS category_count FROM tossup WHERE author_id = ? AND server_id = ? AND category = ?');
const getBonusCategoryCountQuery = db.prepare('SELECT COUNT(*) AS category_count FROM bonus WHERE author_id = ? AND server_id = ? AND category = ?');

const literature_names = ["literature", "lit", "drama", "poetry", "fiction"];
const history_names = ["history", "historiography", "archeology"];
const rmpss_names = ["religion", "myth", "phil", "social", "econ", "psych", "ling", "socio", "anthro", "law"]
const arts_names = ["arts", "paint", "sculpt", "music", "classical", "auditory", "visual", "architecture", "photo", "film", "jazz", "opera", "dance"];
const science_names = ["science", "bio", "chem", "physics", "math", "astro", "computer", "earth", "engineering", "ecology"];
const other_names = ["other", "academic", "geography", "current", "events", "pop", "culture", "trash"];

type nullableString = string | null | undefined;

export const removeSpoilers = (text: string) => text.replaceAll('||', '');
export const shortenAnswerline = (answerline: string) => removeSpoilers(answerline.replace(/ \[.+\]/, '').replace(/ \(.+\)/, '')).trim();
export const removeBonusValue = (bonusPart: string) => bonusPart.replace(/\|{0,2}\[10\|{0,2}[emh]?\|{0,2}]\|{0,2} ?/, '');
export const formatPercent = (value: number | null | undefined, minimumIntegerDigits: number | undefined = undefined, minimumFractionDigits: number = 0) => value == null || value == undefined ? "" : value.toLocaleString(undefined, { style: 'percent', minimumFractionDigits, minimumIntegerDigits });
export const formatDecimal = (value: number | null | undefined, fractionDigits: number = 0) => value == null || value == undefined ? "" : value?.toFixed(fractionDigits);
export const isNumeric = (value: string) => (/^-?\d+$/.test(value));

export const getCategoryName = (metadata: string | undefined) => {
    let category = "";
    if (metadata) {
        metadata = removeSpoilers(metadata);
        let results = metadata.match(/([A-Z]{2,3}), (.*)/);

        if (results) {
            category = results[2].trim();
        }

        results = metadata.match(/(.*), ([A-Z]{2,3})/);

        if (results) {
            category = results[1].trim();
        }
    }

    return category;
}

export const getCategoryRole = (category: string) => {
    let categoryRole = "";
    category = category.toLowerCase();

    if (literature_names.some(v => category.includes(v))) {
        categoryRole = "Literature";
    } else if (history_names.some(v => category.includes(v))) {
        categoryRole = "History";
    } else if (arts_names.some(v => category.includes(v))) {
        categoryRole = "Arts";
    } else if (rmpss_names.some(v => category.includes(v))) {
        categoryRole = "RMPSS";
    } else if (science_names.some(v => category.includes(v))) {
        categoryRole = "Science";
    } else if (other_names.some(v => category.includes(v))) {
        categoryRole = "Other";
    }

    return categoryRole;
}

export enum ServerChannelType {
    Playtesting = 1,
    Reacts = 2,
    Results
}

export enum QuestionType {
    Tossup = 1,
    Bonus
}

export type ServerChannel = {
    server_id: string;
    channel_id: string;
    result_channel_id: string;
    channel_type: number;
}

export type QuestionResult = {
    points: number;
    passed: boolean;
    note: string;
}

export type UserProgress = {
    type: QuestionType;
    serverId: string;
    channelId: string;
    buttonMessageId: string;
    questionId: string;
    questionUrl: string;
    authorId: string;
    authorName: string;
    index: number;
    grade?: boolean;
}

export type UserBonusProgress = UserProgress & {
    leadin: string;
    parts: string[];
    answers: string[];
    difficulties: string[];
    results: QuestionResult[];
}

type Guess = {
    index: number;
    guess: string;
}

export type UserTossupProgress = UserProgress & {
    buzzed: boolean;
    questionParts: string[];
    guesses: Guess[];
    answer: string;
}

export const getTossupParts = (questionText: string) => {
    const regex = /\|\|([^|]+)\|\|/g;
    const matches = [];
    let match;

    while ((match = regex.exec(questionText)) !== null) {
        matches.push(match[1]);
    }

    return matches;
}

export const getEmbeddedMessage = (message: string, silent: boolean = false): MessageCreateOptions => {
    return {
        embeds: [
            new EmbedBuilder().setDescription(message)
        ],
        flags: silent ? [MessageFlags.SuppressNotifications] : undefined
    };
}

export const getSilentMessage = (message: string): MessageCreateOptions => {
    return {
        content: message,
        flags: [MessageFlags.SuppressNotifications]
    };
}

export type BonusPart = {
    part: number;
    answer: string;
    difficulty: nullableString;
}

export const saveTossup = (questionId: string, serverId: string, authorId: string, totalCharacters: number, category: string, answer: string, key: nullableString) => {
    insertTossupCommand.run(questionId, serverId, authorId, totalCharacters, category, encrypt(answer, key));
}

export const saveBonus = (questionId: string, serverId: string, authorId: string, category: string, parts: BonusPart[], key: nullableString) => {
    insertBonusCommand.run(questionId, serverId, authorId, category);

    for (var { part, difficulty, answer } of parts) {
        insertBonusPartCommand.run(questionId, part, difficulty, encrypt(answer, key));
    }
}

export const saveBuzz = (serverId: string, questionId: string, authorId: string, userId: string, clue_index: number, characters_revealed: number, value: number, answerGiven: nullableString, key: nullableString) => {
    insertBuzzCommand.run(serverId, questionId, authorId, userId, clue_index, characters_revealed, value, answerGiven ? encrypt(answerGiven, key) : null);
}

export const saveBonusDirect = (serverId: string, questionId: string, authorId: string, userId: string, part: number, value: number, answerGiven: nullableString, key: nullableString) => {
    insertBonusDirectCommand.run(serverId, questionId, authorId, userId, part, value, answerGiven ? encrypt(answerGiven, key) : null);
}

export const saveAsyncServerChannelsFromMessage = (collected: Collection<string, Message<boolean>>, server: Guild) => {
    let tags = collected?.first()?.content.split(' ') || [];

    tags.forEach((tag) => {
        const [_, channelId, resultsChannelId] = tag.match(/<#(\d+)>\s*\/\s*<#(\d+)>/) || [];
        const channel = server.channels.cache.find((channel) => channel.id === channelId)?.id;
        const resultsChannel = server.channels.cache.find((channel) => channel.id === channelId)?.id;

        if (channel && resultsChannel) {
            insertServerChannelCommand.run(server.id, channelId, resultsChannelId, 1);
        }
    });
}

export const saveBulkServerChannelsFromMessage = (collected: Collection<string, Message<boolean>>, server: Guild) => {
    let tags = collected?.first()?.content.split(' ') || [];

    tags.forEach((tag) => {
        const [_, channelId] = tag.match(/<#(\d+)>/) || [];
        const channel = server.channels.cache.find((channel) => channel.id === channelId)?.id;

        if (channel) {
            insertServerChannelCommand.run(server.id, channelId, "", 2);
        }
    });
}

export const getServerChannels = (serverId: string) => {
    return getServerChannelsQuery.all(serverId) as ServerChannel[];
}

export const updateThreadId = (questionId: string, questionType: QuestionType, threadId: string) => {
    if (questionType === QuestionType.Bonus)
        updateBonusThreadCommand.run(threadId, questionId);
    else
        updateTossupThreadCommand.run(threadId, questionId);
}

export const getThreadId = (questionId: string, questionType: QuestionType) => {
    if (questionType === QuestionType.Bonus)
        return (getBonusThreadQuery.get(questionId) as any).thread_id;
    else
        return (getTossupThreadQuery.get(questionId) as any).thread_id;
}

export const getThreadAndUpdateSummary = async (userProgress: UserProgress, threadName: string, resultsChannel: TextChannel, playtestingChannel: TextChannel) => {
    const threadId = getThreadId(userProgress.questionId, userProgress.type);
    let thread;

    if (!threadId) {
        thread = await resultsChannel.threads.create({
            name: threadName,
            autoArchiveDuration: 60
        });
        updateThreadId(userProgress.questionId, userProgress.type, thread.id);

        try {
            await thread.members.add(userProgress.authorId);
        } catch (error) {
            console.error(`Error adding member to thread: ${error}`);
        }

        const buttonMessage = await playtestingChannel.messages.fetch(userProgress.buttonMessageId);
        const buttonLabel = "Play " + (!!(userProgress.type === QuestionType.Bonus) ? "Bonus" : "Tossup");
        if (buttonMessage) {
            buttonMessage.edit(buildButtonMessage(buttonLabel, "play_question", thread.url));
        }

        if (userProgress.type === QuestionType.Tossup) {
            thread.send(await getTossupSummary(userProgress.questionId, (userProgress as UserTossupProgress).questionParts, (userProgress as UserTossupProgress).answer, userProgress.questionUrl));
        } else {
            thread.send(await getBonusSummary(userProgress.questionId, userProgress.questionUrl));
        }
    } else {
        thread = resultsChannel.threads.cache.find(x => x.id === threadId);
        const resultsMessage = (await thread!.messages.fetch()).find(m => m.content.includes("## Results"));

        if (resultsMessage) {
            if (userProgress.type === QuestionType.Tossup)
                resultsMessage.edit(await getTossupSummary(userProgress.questionId, (userProgress as UserTossupProgress).questionParts, (userProgress as UserTossupProgress).answer, userProgress.questionUrl));
            else
                resultsMessage.edit(await getBonusSummary(userProgress.questionId, userProgress.questionUrl));

        }
    }

    return thread!;
}

export async function getTossupSummary(questionId: string, questionParts: string[], answer: string, questionUrl: string) {
    let tossupSummary = `## Results\n` +
        `### ANSWER: ||${shortenAnswerline(answer)}||\n`;
    const buzzes = getTossupBuzzesQuery.all(questionId) as any[];
    const gets = buzzes.filter(b => b.value > 0);
    const negs = buzzes.filter(b => b.value < 0);
    const groupedBuzzes = listify(group(buzzes, b => b.clue_index), (key, value) => ({
        index: parseInt(key),
        buzzes: value
    }));
    const totalCharacters = questionParts.join('').length;
    let point_values: number[] = [15, 10, 0, -5];
    let points_emoji_names: string[] = ["15", "10", "DNC", "neg5"];
    points_emoji_names = points_emoji_names.map(i => "tossup_" + i);
    let points_emojis = await getEmojiList(points_emoji_names);

    groupedBuzzes.forEach(async function (buzzpoint) {
        let cumulativeCharacters = questionParts.slice(0, buzzpoint.index + 1).join('').length;
        let point_value_msgs: string[] = [];
        let lineSummary = `${formatPercent(cumulativeCharacters / totalCharacters)} | (||${questionParts[buzzpoint.index].substring(0, 30)}||) | `;

        point_values.forEach(async function (point_value: number, i) {
            let point_value_count = buzzpoint.buzzes?.filter(b => b.value == point_value)?.length || 0;
            if (point_value_count > 0) {
                point_value_msgs.push(`${point_value_count} × ${points_emojis[i]}`);
            }
        })

        lineSummary += point_value_msgs.join(' | ');
        tossupSummary += lineSummary + "\n";
    });

    tossupSummary +=
        `\n**Plays:** ${buzzes.length}\t**Conversion Rate**: ${formatPercent(gets.length / buzzes.length)}\t` +
        `**Neg Rate**: ${formatPercent(negs.length / buzzes.length)}\t` +
        `**Avg. Buzz**: ${formatDecimal(100 * (sum(gets, b => b.characters_revealed) / gets.length) / totalCharacters)}% ` +
        `(${formatDecimal(sum(gets, b => b.characters_revealed) / gets.length)})\n` +
        `### [Return to Question](${questionUrl})`;

    return tossupSummary;
}

export async function getBonusSummary(questionId: string, questionUrl: string) {
    const bonusSummary = getBonusSummaryData(questionId) as any;

    let points_emoji_names: string[] = ["E", "M", "H"];
    points_emoji_names = points_emoji_names.map(i => "bonus_" + i);
    let points_emojis = await getEmojiList(points_emoji_names);

    return `## Results\n**Plays**: ${bonusSummary.total_plays}\t` +
        `**PPB**: ${bonusSummary.ppb.toFixed(2)}\t` +
        `**${points_emojis[0] || "Easy"}** ${formatPercent(bonusSummary.easy_conversion)}\t` +
        `**${points_emojis[1] || "Medium"}** ${formatPercent(bonusSummary.medium_conversion)}\t` +
        `**${points_emojis[2] || "Hard"} %** ${formatPercent(bonusSummary.hard_conversion)}\n` +
        `### [Return to Question](${questionUrl})`
}

export const buildButtonMessage = (buttonLabel: string, buttonID: string = "play_question", threadUrl?: string, overwrite: boolean = false): BaseMessageOptions => {
    let buttons = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setStyle(ButtonStyle.Primary)
        .setLabel(buttonLabel)
        .setCustomId(buttonID)
    );

    if (threadUrl) {
        if (overwrite) {
            buttons.setComponents(new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(buttonLabel)
                .setURL(threadUrl)
            );
        } else {
            buttons.addComponents(new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Results")
                .setURL(threadUrl)
            );
        }
    }

    return { components: [buttons] } as BaseMessageOptions;
}

export const getToFirstIndicator = (clue: string) => {
    const words = clue.split(' ');
    const thisIndex = words.findIndex(w => w.toLocaleLowerCase() === 'this' || w.toLocaleLowerCase() === 'these');
    const defaultSize = 30;

    // if "this" or "these" is in the string and isn't the first word,
    // truncate after first pronoun: https://github.com/JemCasey/playtesting-bot/issues/8
    if (thisIndex > 0) {
        const endIndex = thisIndex + 2;

        return `${words.slice(0, endIndex).join(' ')}${endIndex >= words.length ? '' : '...'}`;
    } else {
        return `${clue.substring(0, defaultSize)}${clue.length > defaultSize ? '...' : ''}`;
    }
}

export function getCategoryCount(authorId: string, serverId: string | undefined, category: string, isBonus: boolean): number {
    if (isBonus)
        return (getBonusCategoryCountQuery.get(authorId, serverId, category) as any).category_count as number;
    else
        return (getTossupCategoryCountQuery.get(authorId, serverId, category) as any).category_count as number;
}
