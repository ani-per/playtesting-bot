import { Client, GatewayIntentBits, Partials, ChannelType, Interaction, TextChannel, TextThreadChannel, Events } from "discord.js";
import { config } from "./config";
import handleTossupPlaytest from "./handlers/tossupHandler";
import handleBonusPlaytest from "./handlers/bonusHandler";
import handleNewQuestion from "./handlers/newQuestionHandler";
import handleConfig from "./handlers/configHandler";
import handleButtonClick from "./handlers/buttonClickHandler";
import handleCategoryCommand from "./handlers/categoryCommandHandler";
import handleTally from "./handlers/bulkQuestionHandler";
import { QuestionType, UserBonusProgress, UserProgress, UserTossupProgress, getBulkQuestions, getBulkQuestionsInPacket, getServerChannels, getServerSettings, saveEchoSetting, deleteEchoSetting, getEchoThreadId, updatePacketName, getEchoSettings } from "./utils";
import handleAuthorCommand from "./handlers/authorCommandHandler";

const userProgressMap = new Map<string, UserProgress>();

const startCommands = ["read", "start", "begin"];
const getCommands = ["packet", "status", "round", "info"];
const endCommands = ["end", "quit", "stop"];
const clearCommands = ["reset", "clear"];
const packetCommands = [
    ...startCommands,
    ...endCommands,
    ...getCommands,
];
const tallyCommands = [
    ...startCommands,
    ...endCommands,
    "tally", "count",
];
const deleteCommands = ["delete", "purge"];

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction
    ],
    allowedMentions: {
        parse: []
    }
});

client.once(Events.ClientReady, readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on("messageCreate", async (message) => {
    try {
        if (message.author.id === config.DISCORD_APPLICATION_ID)
            return;
        if (message.content.startsWith("!config")) {
            await handleConfig(message);
        } else if (
            [...packetCommands, ...tallyCommands, ...deleteCommands].some(
                v => message.content.startsWith("!" + v)
            )
        ) {
            let serverId = message.guild!.id;
            let echoChannelId = getServerChannels(serverId).find(c => (c.channel_type === 3))?.channel_id;
            let currentServerSetting = getServerSettings(serverId).find(ss => ss.server_id == serverId);
            let currentPacket = currentServerSetting?.packet_name || "";
            let splits = message.content.split(" ");
            let command = splits[0];
            let packetArgument = splits.length > 1 ? splits.slice(1).join(" ").trim() : "";
            let startPacket = startCommands.some(v => command.startsWith("!" + v));
            let clearPacket = clearCommands.some(v => packetArgument.startsWith(v));
            let endPacket = endCommands.some(v => command.startsWith("!" + v)) || clearPacket;
            let getPacket = getCommands.some(v => command.startsWith("!" + v));
            let noPacket = false;
            let packetToTally = packetArgument;
            if (packetCommands.some(v => message.content.startsWith("!" + v))) {
                if (endPacket || startPacket) {
                    if (
                        startPacket &&
                        packetArgument &&
                        (packetArgument === currentPacket)
                    ) {
                        message.reply(`Packet \`${packetArgument}\` is already being read.`);
                    } else {
                        if (
                            endPacket ||
                            (startPacket && currentPacket)
                        ) {
                            let endMessage = [""];
                            let closingVerb = "";
                            if (
                                endCommands.some(v => command.startsWith("!" + v)) ||
                                packetArgument.startsWith("end") ||
                                (startPacket && currentPacket)
                            ) {
                                closingVerb = "ended";
                            } else {
                                closingVerb = "cleared";
                            }
                            if (currentPacket) {
                                updatePacketName(serverId, "");
                                packetToTally = currentPacket;
                                endMessage.push(`Reading of Packet \`${currentPacket}\` has been ${closingVerb}.`);
                            } else if (packetArgument) {
                                updatePacketName(serverId, "");
                                let packetBulkQuestions = getBulkQuestionsInPacket(serverId, packetArgument);
                                if (packetBulkQuestions.length > 0) {
                                    endMessage.push(`Packet \`${packetArgument}\` ${closingVerb}.`);
                                } else {
                                    endMessage.push(`Packet \`${packetArgument}\` not found.`);
                                }
                            } else {
                                noPacket = true;
                            }
                            if (startPacket && currentPacket) {
                                endMessage.push(`Preparing to read Packet \`${packetArgument}\` ...`);
                            }
                            message.reply(endMessage.join(" "));
                        }
                        if (startPacket && packetArgument) {
                            let newPacketName = updatePacketName(serverId, packetArgument);
                            currentPacket = newPacketName;
                            let printPacketName = newPacketName.length < 2 ? `Packet \`${newPacketName}\`` : `\`${newPacketName}\``;
                            if (echoChannelId) {
                                let echoChannel = (client.channels.cache.get(echoChannelId) as TextChannel);
                                let echoThreadId = getEchoThreadId(serverId, echoChannelId, newPacketName);
                                if (!echoThreadId) {
                                    let packetMessage = await echoChannel.send(`## [${printPacketName}](${message.url})`);
                                    if (packetMessage) {
                                        let newEchoThread = await packetMessage.startThread({
                                            name: printPacketName.replaceAll("\`", ""),
                                            autoArchiveDuration: 60
                                        });
                                        saveEchoSetting(serverId, echoChannelId, newPacketName, newEchoThread?.id);
                                        message.reply(`Reading of [${printPacketName}](${newEchoThread.url}) has begun.`);
                                    }
                                } else {
                                    let echoThread = echoChannel!.threads.cache.find(x => x.id === echoThreadId) as TextThreadChannel;
                                    message.reply(`Resumed reading of [${printPacketName}](${echoThread.url}).`);
                                }
                            } else {
                                message.reply("Could not begin reading. An echo channel has not been configured.");
                            }
                        }
                    }
                } else if (getPacket) {
                    if (packetArgument) {
                        let packetBulkQuestions = getBulkQuestionsInPacket(serverId, packetArgument);
                        message.reply(`${packetBulkQuestions.length} questions have been read as part of Packet \`${packetArgument}\`.`);
                    } else if (currentPacket) {
                        message.reply(`The current packet is \`${currentPacket}\`.`);
                    } else {
                        noPacket = true;
                    }
                }
            }
            if (tallyCommands.some(v => command.startsWith("!" + v))) {
                if (packetToTally) {
                    if (packetToTally.includes("all")) {
                        [...new Set(getBulkQuestions(serverId).map(u => u.packet_name))].forEach(async packet => {
                            let tallyBulkQuestions = getBulkQuestionsInPacket(serverId, packet);
                            if (tallyBulkQuestions.length > 0) {
                                await handleTally(serverId, packet, message);
                            } else {
                                message.reply(`No questions to tally in Packet ${packet}.`);
                            }
                        });
                    } else if (
                        !(startPacket && (packetToTally === currentPacket))
                    ) {
                        let tallyBulkQuestions = getBulkQuestionsInPacket(serverId, packetToTally);
                        if (tallyBulkQuestions.length > 0) {
                            await handleTally(serverId, packetToTally, message);
                        } else {
                            message.reply(`No questions to tally in Packet \`${packetToTally}\`.`);
                        }
                    }
                } else {
                    if (currentPacket) {
                        await handleTally(serverId, currentPacket, message);
                    } else if (packetArgument) {
                        noPacket = true;
                    }
                }
            }
            if (noPacket) {
                message.reply("No packet is being read right now.");
            }
            if (deleteCommands.some(v => command.startsWith("!" + v))) {
                if (packetArgument) {
                    if (echoChannelId) {
                        let deleteMessage = [""];
                        let echoSetting = getEchoSettings(serverId, echoChannelId).find(es => es.packet_name === packetArgument);
                        if (echoSetting) {
                            deleteEchoSetting(serverId, packetArgument);
                            let echoChannel = (client.channels.cache.get(echoSetting.channel_id) as TextChannel);
                            let echoThread = echoChannel!.threads.cache.find(x => x.id === echoSetting.thread_id) as TextThreadChannel;
                            let echoMessage = await echoChannel!.messages.fetch(echoSetting.thread_id);
                            if (echoMessage) {
                                await echoMessage.delete();
                            }
                            await echoThread.delete();
                            if (currentPacket === packetArgument) {
                                updatePacketName(serverId, "");
                                deleteMessage.push(`Reading of Packet \`${currentPacket}\` has been ended.`);
                            }
                            deleteMessage.push(`Packet \`${packetArgument}\` and its associated thread have been deleted.`);
                            message.reply(deleteMessage.join(" "));
                        } else {
                            message.reply(`Packet \`${packetArgument}\` does not exist.`);
                        }
                    } else {
                        message.reply("Echo channel not configured.");
                    }
                } else {
                    message.reply("No packet name was provided to delete settings.")
                }
            }
        } else if (message.content.startsWith("!category")) {
            await handleCategoryCommand(message);
        } else if (message.content.startsWith("!author")) {
            await handleAuthorCommand(message);
        } else {
            let setUserProgress = userProgressMap.set.bind(userProgressMap);
            let deleteUserProgress = userProgressMap.delete.bind(userProgressMap);

            if (message.channel.type !== ChannelType.DM && message.content.includes("ANSWER:")) {
                await handleNewQuestion(message);
            } else if (message.channel.type === ChannelType.DM) {
                let userProgress = userProgressMap.get(message.author.id)

                if (userProgress?.type === QuestionType.Tossup) {
                    await handleTossupPlaytest(message, client, userProgress as UserTossupProgress, setUserProgress, deleteUserProgress);
                } else if (userProgress?.type === QuestionType.Bonus) {
                    await handleBonusPlaytest(message, client, userProgress as UserBonusProgress, setUserProgress, deleteUserProgress);
                }
            }
        }
    } catch (e) {
        console.log(e);
    }
});

client.on("interactionCreate", async (interaction: Interaction) => {
    try {
        await handleButtonClick(interaction, userProgressMap, userProgressMap.set.bind(userProgressMap));
    } catch (e) {
        console.log(e);
    }
});

client.login(config.DISCORD_TOKEN);
