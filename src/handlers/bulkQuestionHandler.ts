import { Message, TextChannel, TextThreadChannel } from "discord.js";
import { powerMarks, superPowerMarks, getServerChannels, getBulkQuestionsInPacket, formatPercent, getEchoThreadId, printPacketName, deleteBulkQuestion } from "src/utils";
import { client } from "src/bot";
import { getEmojiList } from "src/utils/emojis";

type userReact = {
    users: number[],
    emoji: string;
    count: number;
}

export default async function handleTally(serverId: string, packetName: string, message: Message) {
    let packetBulkQuestions = getBulkQuestionsInPacket(serverId, packetName);
    if (packetBulkQuestions.length > 0) {
        let tallyCount = 0;
        var tallyEnd = packetBulkQuestions.length;
        let pluralString = (tallyEnd > 1 || tallyEnd == 0) ? "s" : "";
        let echoChannelId = getServerChannels(serverId).find(c => (c.channel_type === 3))?.channel_id;
        if (echoChannelId) {
            let echoChannel = client.channels.cache.get(echoChannelId) as TextChannel;
            let echoThreadId = getEchoThreadId(serverId, echoChannelId, packetName);
            let echoThread = echoChannel!.threads.cache.find(x => x.id === echoThreadId) as TextThreadChannel;
            let tallyPacketDesc = echoThread ? `[${printPacketName(packetName)}](${echoThread!.url})` : `${printPacketName(packetName)}`
            let tallyReply = await message.reply(`Tallying reacts for ${packetBulkQuestions.length} question${pluralString} in ${tallyPacketDesc} ...`);
            for await (const bulkQuestion of packetBulkQuestions) {
                try {
                    let echoMessage = await echoThread!.messages.fetch(bulkQuestion.echo_id);
                    let questionChannel = client.channels.cache.get(bulkQuestion.channel_id) as TextChannel;

                    // Refresh the message's react count by deleting the cache and re-fetching
                    questionChannel.messages.cache.delete(bulkQuestion.question_id);
                    try {
                        let questionMessage = await questionChannel.messages.fetch(bulkQuestion.question_id);
                        if (questionMessage) {
                            if (echoMessage) {
                                let reacts: string[] = [];
                                if (bulkQuestion.question_type === "B") {
                                    reacts = [...reacts, "bonus_E", "bonus_M", "bonus_H", "bonus_0"];
                                } else {
                                    if (superPowerMarks.some(s => questionMessage.content.includes(s))) {
                                        reacts = [...reacts, "tossup_20"];
                                    }
                                    if (powerMarks.some(s => questionMessage.content.includes(s))) {
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
                                let react_emoji = getEmojiList(reacts);

                                let reactCounts: userReact[] = [];
                                for await (const [_, react] of questionMessage.reactions.cache?.filter(react => react_emoji.includes(react.emoji.toString()) && react.count)) {
                                    let thisReactUserCollection = await react.users.fetch();
                                    let reactUsers = thisReactUserCollection.map(u => Number(u.id));
                                    if (reactUsers) {
                                        reactCounts.push({
                                            users: reactUsers,
                                            emoji: react.emoji.toString(),
                                            count: react.count - 1
                                        });
                                    }
                                }

                                if (reactCounts.some(userReact => userReact.count > 0)) {
                                    let answer_emoji = (getEmojiList(["answer"]))[0];
                                    let newEcho = "### [" +
                                        (bulkQuestion.question_type === "B" ? "Bonus " : "Tossup ") +
                                        (
                                            bulkQuestion.question_number ?
                                                (bulkQuestion.question_number + " ")
                                                : ""
                                        ) +
                                        "- " +
                                        bulkQuestion.category +
                                        "](" + questionMessage.url + ")" + "\n" +
                                        "* " + ((answer_emoji + " ") || "") +
                                        `||${bulkQuestion.answers}||`;

                                    let play_count_emoji = getEmojiList(["play_count"]);
                                    let reactedUsers = [... new Set(reactCounts.map(userReact => [...userReact.users]).flat().filter(u => u != Number(client.user?.id)))];
                                    let playCount = reactedUsers.length > 0 ? reactedUsers.length : 1;
                                    newEcho += `\n* **${playCount}** × ${play_count_emoji} \t`;
                                    newEcho += reactCounts.map(userReact =>
                                        `**${userReact.count}** × ${userReact.emoji} (${formatPercent(userReact.count / playCount)})`
                                    ).join("\t");

                                    echoMessage.edit(newEcho);
                                }
                                tallyCount++;
                            } else {
                                console.log(`Echo message (ID ${bulkQuestion.echo_id} in thread ${echoThreadId}) for question ${bulkQuestion.question_number} in ${tallyPacketDesc} not found for tallying.`);
                            }
                        } else {
                            deleteBulkQuestion(serverId, bulkQuestion.question_id);
                            tallyEnd -= 1;
                        }
                    } catch (error: any) {
                        console.log(`Question message (ID ${bulkQuestion.question_id}) for question ${bulkQuestion.question_number} in ${tallyPacketDesc} not found.`);
                        if (error.code === 10008) {
                            deleteBulkQuestion(serverId, bulkQuestion.question_id);
                            if (echoMessage) {
                                await echoMessage.delete();
                            }
                        }
                        tallyEnd -= 1;
                    }
                } catch {
                    console.log(`Echo message (ID ${bulkQuestion.echo_id} in thread ${echoThreadId}) for question ${bulkQuestion.question_number} in ${tallyPacketDesc} not found.`);
                }
                pluralString = (tallyEnd > 1 || tallyEnd == 0) ? "s" : "";
                await tallyReply.edit(`Tallied reacts for ${tallyCount} of ${tallyEnd} question${pluralString} in ${tallyPacketDesc} ...`);
            }
            pluralString = (tallyEnd > 1 || tallyEnd == 0) ? "s" : "";
            if (tallyCount === tallyEnd) {
                await tallyReply.edit(`Tallied reacts for ${tallyCount} question${pluralString} in ${tallyPacketDesc}.`);
            } else if (tallyCount < tallyEnd) {
                tallyReply.edit(`Tallied reacts for ${tallyCount} of ${tallyEnd} question${pluralString} in ${tallyPacketDesc}.`);
                tallyReply.reply(`Errors in tallying ${tallyEnd - tallyCount} of ${tallyEnd} question${pluralString} in ${tallyPacketDesc}.`);
            }
        } else {
            console.log(`Echo channel not found for server ${serverId}.`);
        }
    } else {
        await message.reply(`No questions in ${printPacketName(packetName)} to tally.`);
    }
}
