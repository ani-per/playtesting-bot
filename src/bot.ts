import { Client, GatewayIntentBits, Partials, ChannelType, Interaction, TextChannel, TextThreadChannel, Events } from "discord.js";
import { config } from "./config";
import handleTossupPlaytest from "./handlers/tossupHandler";
import handleBonusPlaytest from "./handlers/bonusHandler";
import handleNewQuestion from "./handlers/newQuestionHandler";
import handleConfig from "./handlers/configHandler";
import handleButtonClick from "./handlers/buttonClickHandler";
import handleCategoryCommand from "./handlers/categoryCommandHandler";
import handleTally from "./handlers/bulkQuestionHandler";
import { QuestionType, UserBonusProgress, UserProgress, UserTossupProgress, getBulkQuestions, getBulkQuestionsInPacket, getServerChannels, getServerSettings, saveEchoSetting, getEchoThreadId, updatePacketName } from "./utils";
import handleAuthorCommand from "./handlers/authorCommandHandler";

const userProgressMap = new Map<string, UserProgress>();

const packetCommands = [
    "end", "quit", // "End" commands
    "read", "start", // "Start" commands
    "packet", "status", "round", // "Get" commands
];
const tallyCommands = [
    "end", "quit", // "End" commands
    "read", "start", // "Start" commands
    "tally", "count", // "Tally" commands
];

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
    let serverId = message.guild!.id;
    try {
        if (message.author.id === config.DISCORD_APPLICATION_ID)
            return;
        if (message.content.startsWith("!config")) {
            await handleConfig(message);
        } else if ([...packetCommands, ...tallyCommands].some(v => message.content.startsWith("!" + v))) {
            let currentServerSetting = getServerSettings(serverId).find(ss => ss.server_id == serverId);
            let currentPacket = currentServerSetting?.packet_name || "";
            let splits = message.content.split(" ");
            let command = splits[0];
            let packetArgument = splits.length > 1 ? splits.slice(1).join(" ").trim() : "";
            let startPacket = command.startsWith("!read") ||
                command.startsWith("!start");
            let endPacket = command.startsWith("!end") ||
                packetArgument.startsWith("end") ||
                packetArgument.startsWith("reset") ||
                packetArgument.startsWith("clear");
            let getPacket = command.startsWith("!packet") ||
                command.startsWith("!status") ||
                command.startsWith("!round");
            let noPacket = false;
            let packetToTally = packetArgument;
            if (packetCommands.some(v => message.content.startsWith("!" + v))) {
                if (endPacket || startPacket) {
                    if (
                        startPacket &&
                        (packetArgument === currentPacket)
                    ) {
                        message.reply(`Packet \`${packetArgument}\` is already being read.`);
                    } else {
                        if (
                            endPacket ||
                            (startPacket && currentPacket)
                        ) {
                            let closingVerb = "";
                            if (
                                command.startsWith("!end") ||
                                packetArgument.startsWith("end") ||
                                (startPacket && currentPacket)
                            ) {
                                closingVerb = "ended";
                            } else {
                                closingVerb = "cleared";
                            }
                            if (currentPacket) {
                                updatePacketName(serverId, "");
                                message.reply(`Packet \`${currentPacket}\` ${closingVerb}.`);
                                packetToTally = currentPacket;
                            } else if (packetArgument) {
                                updatePacketName(serverId, "");
                                let packetBulkQuestions = getBulkQuestionsInPacket(serverId, packetArgument);
                                if (packetBulkQuestions.length > 0) {
                                    message.reply(`Packet \`${packetArgument}\` ${closingVerb}.`);
                                } else {
                                    message.reply(`Packet \`${packetArgument}\` not found.`);
                                }
                            } else {
                                noPacket = true;
                            }
                        }
                        if (startPacket) {
                            let newPacketName = updatePacketName(serverId, packetArgument);
                            currentPacket = newPacketName;
                            let printPacketName = newPacketName.length < 2 ? `Packet ${newPacketName}` : newPacketName;
                            const echoChannelId = getServerChannels(serverId).find(c => (c.channel_type === 3))?.channel_id;
                            if (echoChannelId) {
                                const echoChannel = (client.channels.cache.get(echoChannelId) as TextChannel);
                                let echoThreadId = getEchoThreadId(serverId, echoChannelId, newPacketName);
                                if (!echoThreadId) {
                                    let packetMessage = await echoChannel.send(`# ${printPacketName}`);
                                    if (packetMessage) {
                                        const newEchoThread = await packetMessage.startThread({
                                            name: printPacketName,
                                            autoArchiveDuration: 60
                                        });
                                        saveEchoSetting(serverId, echoChannelId, newPacketName, newEchoThread?.id);
                                        message.reply(`Now reading [\`${printPacketName}\`](${newEchoThread.url}).`);
                                    }
                                } else {
                                    let echoThread = echoChannel!.threads.cache.find(x => x.id === echoThreadId) as TextThreadChannel;
                                    message.reply(`Resuming reading [\`${printPacketName}\`](${echoThread.url}).`);
                                }
                            } else {
                                message.reply("Cannot begin reading. An echo channel is not configured.");
                            }
                        }
                    }
                } else if (getPacket) {
                    if (packetArgument) {
                        let packetBulkQuestions = getBulkQuestionsInPacket(serverId, packetArgument);
                        message.reply(`${packetBulkQuestions.length} questions have been read as part of packet \`${packetArgument}\`.`);
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
                                message.reply(`No questions in packet ${packet} to tally.`);
                            }
                        });
                    } else if (
                        !(startPacket && packetToTally === currentPacket)
                    ) {
                        let tallyBulkQuestions = getBulkQuestionsInPacket(serverId, packetToTally);
                        if (tallyBulkQuestions.length > 0) {
                            await handleTally(serverId, packetToTally, message);
                        } else {
                            message.reply(`No questions in packet \`${packetToTally}\` to tally.`);
                        }
                    }
                } else {
                    if (currentPacket) {
                        await handleTally(serverId, currentPacket, message);
                    } else {
                        noPacket = true;
                    }
                }
            }
            if (noPacket) {
                message.reply("No packet is being read right now.");
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
