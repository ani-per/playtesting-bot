import { Message, Application, TextChannel } from "discord.js";
import { client, safeSend } from "src/bot";
import { ASYNC_CHANNEL, asyncCharLimit, BONUS_DIFFICULTY_REGEX, BONUS_REGEX, BULK_CHANNEL, bulkCharLimit, ECHO_CHANNEL, TOSSUP_REGEX } from "src/constants";
import KeySingleton from "src/services/keySingleton";
import { powerMarks, superPowerMarks, buildButtonMessage, getCategoryCount, getServerChannels, getTossupParts, getToFirstIndicator, removeSpoilers, saveBonus, BonusPart, saveTossup, shortenAnswerline, getCategoryName, getCategoryRole, isNumeric, ServerChannel, removeQuestionNumber, getQuestionNumber, addRoles, getServerSettings, saveBulkQuestion, getEchoThreadId, cleanThreadName, stripFormatting, abbreviate, removeMentions } from "src/utils";
import { getEmojiList, reactEmojiList } from "src/utils/emojis";

async function handleThread(msgChannel: ServerChannel, message: Message, isBonus: boolean, question: string, metadata: string, questionNumber: string = "") {
    let thisServerSetting = getServerSettings(message.guild!.id).find(ss => ss.server_id == message.guild!.id);
    let threadName = "Discussion Thread";
    let fallbackName = cleanThreadName(getToFirstIndicator(stripFormatting(removeQuestionNumber(question)), msgChannel.channel_type === BULK_CHANNEL ? bulkCharLimit : asyncCharLimit));

    let categoryName = getCategoryName(metadata);
    let categoryRoleName = getCategoryRole(categoryName);

    // console.log(`Metadata: ${metadata}`);
    // console.log(`Category Name: ${categoryName}; Category Role Name: ${categoryRoleName}`);

    if (msgChannel.channel_type === BULK_CHANNEL) {
        threadName = metadata ?
            `${thisServerSetting?.packet_name ?
                abbreviate(thisServerSetting?.packet_name) + "." :
                ""
            }${isBonus ? "B" : "T"}${questionNumber} | ${categoryName} | ${fallbackName}` :
            `${isBonus ? "B" : "T"} | ${fallbackName}`;
    } else if (msgChannel.channel_type === ASYNC_CHANNEL) {
        threadName = metadata ?
            `${metadata} | ${isBonus ? "B" : "T"}${getCategoryCount(message.author.id, message.guild?.id, categoryName, isBonus)}` :
            `${isBonus ? "B" : "T"} | ${fallbackName}`;
    }

    const thread = await message.startThread({
        name: threadName.replaceAll(/\s\s+/g, " ").trim(),
        autoArchiveDuration: 60
    });

    if (thread) {
        await addRoles(message, thread, ["Head Editor"], false);
        if (msgChannel.channel_type === ASYNC_CHANNEL) {
            await thread.members.add(message.author);
            await addRoles(message, thread, [categoryRoleName], true);
        } else if (msgChannel.channel_type === BULK_CHANNEL) {
            await addRoles(message, thread, ["Playtester", categoryRoleName], true);
        }
    }
}

async function echoQuestion(question: string, echoChannelId: string, echoThreadId: string) {
    const echoChannel = (client.channels.cache.get(echoChannelId) as TextChannel);
    const echoThread = echoChannel!.threads.cache.find(x => x.id === echoThreadId);
    if (echoThread) {
        return await safeSend(echoThread, question.replace("!t", "").trim());
    } else {
        return null;
    }
}

async function handleReacts(message: Message, isBonus: boolean, parts: BonusPart[]) {
    var reacts: string[] = [];
    if (isBonus) {
        for (var { part, difficulty, answer } of parts) {
            reacts = [...reacts, "bonus_" + difficulty?.toUpperCase()];
        }
        reacts = [...reacts, "bonus_0"];
    } else {
        if (superPowerMarks.some(s => message.content.includes(s))) {
            reacts = [...reacts, "tossup_20"];
        }
        if (powerMarks.some(s => message.content.includes(s))) {
            reacts = [...reacts, "tossup_15"];
        }
        reacts = [
            ...reacts,
            "tossup_10",
            // "tossup_0",
            "tossup_DNC",
            "tossup_neg5",
            // "tossup_FTP",
        ];
    }

    reactEmojiList(message, reacts);
}

export default async function handleNewQuestion(message: Message<boolean>) {
    const bonusMatch = message.content.match(BONUS_REGEX);
    const tossupMatch = message.content.match(TOSSUP_REGEX);
    const playtestingChannels = getServerChannels(message.guild!.id);
    const key = KeySingleton.getInstance().getKey(message);

    const msgChannel = playtestingChannels.find(c => (c.channel_id === message.channel.id));

    if (msgChannel && (bonusMatch || tossupMatch)) {
        let threadQuestionText = "";
        let threadMetadata = "";
        let difficulties = [
            { part: 1, answer: "", difficulty: "" },
            { part: 2, answer: "", difficulty: "" },
            { part: 3, answer: "", difficulty: "" },
        ];
        let questionNumber = "";
        let questionEcho = "";
        let answersEcho: string[] = [];

        if (bonusMatch) {
            let [_, leadin, part1, answer1, part2, answer2, part3, answer3, metadata, difficultyPart1, difficultyPart2, difficultyPart3] = bonusMatch;
            const difficulty1Match = part1.match(BONUS_DIFFICULTY_REGEX) || [];
            const difficulty2Match = part2.match(BONUS_DIFFICULTY_REGEX) || [];
            const difficulty3Match = part3.match(BONUS_DIFFICULTY_REGEX) || [];
            leadin = removeMentions(leadin);
            threadQuestionText = leadin;
            threadMetadata = removeSpoilers(metadata);
            questionNumber = getQuestionNumber(leadin);
            // console.log(leadin);
            // console.log(part1);
            // console.log(answer1);
            // console.log(part2);
            // console.log(answer2);
            // console.log(part3);
            // console.log(answer3);
            // console.log(metadata);
            // console.log(threadMetadata);
            // console.log(difficultyPart1);
            // console.log(difficultyPart2);
            // console.log(difficultyPart3);

            difficulties = [
                { part: 1, answer: shortenAnswerline(answer1), difficulty: difficultyPart1 || difficulty1Match[1] || "e" },
                { part: 2, answer: shortenAnswerline(answer2), difficulty: difficultyPart2 || difficulty2Match[1] || "m" },
                { part: 3, answer: shortenAnswerline(answer3), difficulty: difficultyPart3 || difficulty3Match[1] || "h" },
            ];
            if (msgChannel.channel_type === BULK_CHANNEL) {
                await handleReacts(message, !!bonusMatch, difficulties);
            } else if (msgChannel.channel_type === ASYNC_CHANNEL) {
                saveBonus(message.id, message.guildId!, message.author.id, getCategoryName(threadMetadata), difficulties, key);
            }
            answersEcho.push(shortenAnswerline(answer1));
            answersEcho.push(shortenAnswerline(answer2));
            answersEcho.push(shortenAnswerline(answer3));
        } else if (tossupMatch) {
            let [_, question, answer, metadata] = tossupMatch;
            const tossupParts = getTossupParts(question);
            const questionLength = tossupParts.reduce((a, b) => {
                return a + b.length;
            }, 0);
            question = removeMentions(question);
            threadQuestionText = question;
            threadMetadata = removeSpoilers(metadata);
            questionNumber = getQuestionNumber(question);

            // if a tossup was sent that has 2 or fewer spoiler tagged sections, assume that it's not meant to be played
            if (msgChannel.channel_type === ASYNC_CHANNEL && tossupParts.length <= 2) {
                safeSend(message, "The pasted tossup doesn't seem to be properly spoiler-tagged. Try again using the [paster dingus](https://minkowski.space/quizbowl/paster/) to auto-format the tossup.", "reply");
                return;
            }

            if (msgChannel.channel_type === BULK_CHANNEL) {
                await handleReacts(message, !!bonusMatch, difficulties);
            } else if (msgChannel.channel_type === ASYNC_CHANNEL) {
                saveTossup(message.id, message.guildId!, message.author.id, questionLength, getCategoryName(threadMetadata), shortenAnswerline(answer), key);
            }
            answersEcho.push(shortenAnswerline(answer));
        }

        if (msgChannel.channel_type !== ECHO_CHANNEL) {
            if (msgChannel.channel_type === BULK_CHANNEL) {
                let serverId = message.guild!.id;
                let thisServerSetting = getServerSettings(serverId).find(ss => ss.server_id == serverId);
                const packetName = thisServerSetting?.packet_name || "";
                const echoChannelId = playtestingChannels.find(c => (c.channel_type === ECHO_CHANNEL))?.channel_id;
                if (echoChannelId) {
                    const echoThreadId = getEchoThreadId(serverId, echoChannelId, packetName);
                    let answer_emoji = (getEmojiList(["answer"]))[0];
                    questionEcho = "### [" +
                        (!!bonusMatch ? "Bonus " : "Tossup ") +
                        (
                            isNumeric(questionNumber) ?
                                (questionNumber + " ") :
                                ""
                        ) +
                        "- " +
                        getCategoryName(threadMetadata) +
                        "](" + message.url + ")" + "\n" +
                        "* " + ((answer_emoji + " ") || "") +
                        "||" + answersEcho.join(" / ") + "||";
                    // questionEcho += " - ||" + getToFirstIndicator(removeQuestionNumber(threadQuestionText), bulkCharLimit) + "||";
                    let echoMessage = await echoQuestion(questionEcho, echoChannelId, echoThreadId);
                    if (echoMessage) {
                        saveBulkQuestion(
                            message.guild!.id,
                            message.id,
                            msgChannel.channel_id, packetName || "",
                            isNumeric(questionNumber) ? Number(questionNumber) : 0,
                            (!!bonusMatch ? "B" : "T"),
                            getCategoryName(threadMetadata),
                            answersEcho,
                            echoMessage.id
                        );
                        if (message.content.includes("!t")) {
                            safeSend(message, buildButtonMessage([
                                { label: "Go to Index", id: "echo", url: echoMessage?.url || "" }
                            ]), "reply");
                        } else {
                            safeSend(message, buildButtonMessage([
                                { label: "Create Discussion Thread", id: "bulk_thread", url: "" },
                                { label: "Go to Index", id: "", url: echoMessage?.url || "" },
                            ]), "reply");
                        };
                    } else if (!message.content.includes("!t")) {
                        safeSend(message, buildButtonMessage([
                            { label: "Create Discussion Thread", id: "bulk_thread", url: "" }
                        ]), "reply");
                    }
                }
            } else if (msgChannel.channel_type === ASYNC_CHANNEL) {
                const buttonLabel = "Play " + (!!bonusMatch ? "Bonus" : "Tossup");
                if (message.content.includes("!t")) {
                    safeSend(message, buildButtonMessage([
                        { label: buttonLabel, id: "play_question", url: "" },
                    ]), "reply");
                } else {
                    safeSend(message, buildButtonMessage([
                        { label: "Create Discussion Thread", id: "async_thread", url: "" },
                        { label: buttonLabel, id: "play_question", url: "" },
                    ]), "reply");
                }
            }
            if (message.content.includes("!t")) {
                await handleThread(msgChannel, message, !!bonusMatch, threadQuestionText, threadMetadata, isNumeric(questionNumber) ? questionNumber : "");
            }
        }
    }
}
