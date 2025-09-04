import { Client, GatewayIntentBits, Partials, ChannelType, Interaction, TextChannel, Events } from "discord.js";
import { config } from "./config";
import handleTossupPlaytest from "./handlers/tossupHandler";
import handleBonusPlaytest from "./handlers/bonusHandler";
import handleNewQuestion from "./handlers/newQuestionHandler";
import handleConfig from "./handlers/configHandler";
import handleButtonClick from "./handlers/buttonClickHandler";
import handleCategoryCommand from "./handlers/categoryCommandHandler";
import handleTally from "./handlers/bulkQuestionHandler";
import { QuestionType, UserBonusProgress, UserProgress, UserTossupProgress, getBulkQuestions, getBulkQuestionsInPacket, getServerChannels, getServerSettings, updatePacketName } from "./utils";
import handleAuthorCommand from "./handlers/authorCommandHandler";

const userProgressMap = new Map<string, UserProgress>();

const packetCommands = ["packet", "status", "round", "read", "end"];
const tallyCommands = ["tally", "count", "end"];

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
        } else if ([...packetCommands, ...tallyCommands].some(v => message.content.startsWith("!" + v))) {
            let currentServerSetting = getServerSettings(message.guild!.id).find(ss => ss.server_id == message.guild!.id);
            let currentPacket = currentServerSetting?.packet_name;
            if (tallyCommands.some(v => message.content.startsWith("!" + v))) {
                let splits = message.content.split(" ");
                if (splits.length > 1) {
                    let desiredPacketCommand = splits.slice(1).join(" ");
                    if (desiredPacketCommand) {
                        if (desiredPacketCommand.includes("all")) {
                            [...new Set(getBulkQuestions(message.guild!.id).map(u => u.packet_name))].forEach(async packet => {
                                let desiredPacketBulkQuestions = getBulkQuestionsInPacket(message.guild!.id, packet);
                                if (desiredPacketBulkQuestions) {
                                    await handleTally(message.guild!.id, packet, message);
                                } else {
                                    message.reply(`No questions in packet ${packet} yet.`);
                                }
                            });
                        } else {
                            let desiredPacket = desiredPacketCommand.trim();
                            let desiredPacketBulkQuestions = getBulkQuestionsInPacket(message.guild!.id, desiredPacket);
                            if (desiredPacketBulkQuestions) {
                                await handleTally(message.guild!.id, desiredPacket, message);
                            } else {
                                message.reply(`No questions in packet ${desiredPacket} yet.`);
                            }
                        }
                    } else {
                        message.reply("Invalid packet name.");
                    }
                } else {
                    if (currentPacket) {
                        await handleTally(message.guild!.id, currentPacket, message);
                    } else {
                        message.reply("Packet not configured yet.");
                    }
                }
            }
            if (packetCommands.some(v => message.content.startsWith("!" + v))) {
                let splits = message.content.split(" ");
                let endPacket = message.content.startsWith("!end");
                if (splits.length > 1 || endPacket) {
                    let desiredPacketCommand = splits.slice(1).join(" ");
                    if (desiredPacketCommand || endPacket) {
                        let desiredPacket = desiredPacketCommand.trim();
                        if (desiredPacketCommand.includes("reset") || desiredPacketCommand.includes("clear") || endPacket) {
                            if (desiredPacket.length > 0) {
                                updatePacketName(message.guild!.id, "");
                                message.reply(`Packet ${desiredPacket} ${endPacket ? "finished" : "cleared"}.`);
                            } else if (currentPacket) {
                                updatePacketName(message.guild!.id, "");
                                message.reply(`Packet ${currentPacket} ${endPacket ? "finished" : "cleared"}.`);
                            }
                        } else {
                            let newPacketName = updatePacketName(message.guild!.id, desiredPacket);
                            newPacketName = desiredPacket.length < 2 ? `Packet ${newPacketName}` : newPacketName;
                            message.reply(`Now reading ${newPacketName}.`);
                            const echoChannelId = getServerChannels(message.guild!.id).find(c => (c.channel_type === 3))?.channel_id;
                            if (echoChannelId) {
                                const echoChannel = (client.channels.cache.get(echoChannelId) as TextChannel);
                                echoChannel.send(`# ${newPacketName}`);
                            }
                        }
                    } else {
                        if (message.content.startsWith("!packet") || message.content.startsWith("!round")) {
                            if (currentPacket) {
                                message.reply(`The current packet is ${currentPacket}.`);
                            } else {
                                message.reply("Packet not configured yet.");
                            }
                        }
                    }
                } else {
                    if (message.content.startsWith("!packet") || message.content.startsWith("!status") || message.content.startsWith("!round")) {
                        if (currentPacket) {
                            message.reply(`The current packet is ${currentPacket}.`);
                        } else {
                            message.reply("Packet not configured yet.");
                        }
                    }
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
