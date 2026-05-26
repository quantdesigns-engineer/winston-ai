package slack

import (
	"context"
	"errors"
	"log"
	"os"

	"github.com/quantdesigns-engineer/winston-ai/internal/agents"
	slackapi "github.com/slack-go/slack"
	"github.com/slack-go/slack/slackevents"
	"github.com/slack-go/slack/socketmode"
)

// ErrSocketModeNotConfigured is returned when SLACK_APP_TOKEN is unset.
var ErrSocketModeNotConfigured = errors.New("SLACK_APP_TOKEN not set")

// RunSocketMode opens an outbound websocket to Slack and dispatches events,
// slash commands, and interactions. Blocks until ctx is cancelled or the
// connection terminates fatally.
//
// Requires SLACK_BOT_TOKEN (xoxb-) and SLACK_APP_TOKEN (xapp-) with the
// connections:write scope on the app-level token.
func RunSocketMode(ctx context.Context, manager *agents.Manager) error {
	if os.Getenv("SLACK_APP_TOKEN") == "" {
		return ErrSocketModeNotConfigured
	}
	if Client == nil {
		return errors.New("slack client not initialized (SLACK_BOT_TOKEN unset)")
	}

	sm := socketmode.New(Client)

	go func() {
		for evt := range sm.Events {
			switch evt.Type {
			case socketmode.EventTypeConnecting:
				log.Printf("[slack/socket] connecting...")
			case socketmode.EventTypeConnectionError:
				log.Printf("[slack/socket] connection error: %v", evt.Data)
			case socketmode.EventTypeConnected:
				log.Printf("[slack/socket] connected")
			case socketmode.EventTypeHello:
				// no-op
			case socketmode.EventTypeDisconnect:
				log.Printf("[slack/socket] disconnected")
			case socketmode.EventTypeSlashCommand:
				cmd, ok := evt.Data.(slackapi.SlashCommand)
				if !ok {
					continue
				}
				command := cmd.Command
				// Strip the leading slash that Slack always sends.
				if len(command) > 0 && command[0] == '/' {
					command = command[1:]
				}
				if !manager.HasAgent(command) {
					sm.Ack(*evt.Request, map[string]any{
						"response_type": "ephemeral",
						"text":          unknownAgentMessage(command),
					})
					continue
				}
				// Echo the slash command in-channel so it appears as the user's message.
				sm.Ack(*evt.Request, map[string]any{
					"response_type": "in_channel",
					"text":          cmd.Text,
				})
				go runSlashCommand(manager, command, cmd.Text, cmd.ChannelID)

			case socketmode.EventTypeEventsAPI:
				payload, ok := evt.Data.(slackevents.EventsAPIEvent)
				if !ok {
					continue
				}
				sm.Ack(*evt.Request)
				if payload.Type != slackevents.CallbackEvent {
					continue
				}
				switch ev := payload.InnerEvent.Data.(type) {
				case *slackevents.AppMentionEvent:
					if ev.BotID != "" {
						continue
					}
					go handleMention(manager, ev.Text, ev.Channel, ev.ThreadTimeStamp)
				case *slackevents.MessageEvent:
					if ev.BotID != "" || ev.SubType != "" {
						continue
					}
					if ev.ThreadTimeStamp == "" {
						continue
					}
					go handleThreadMessage(manager, ev.Text, ev.Channel, ev.ThreadTimeStamp)
				}

			case socketmode.EventTypeInteractive:
				interaction, ok := evt.Data.(slackapi.InteractionCallback)
				if !ok {
					continue
				}
				sm.Ack(*evt.Request)
				dispatchInteraction(manager, &interaction)
			}
		}
	}()

	return sm.RunContext(ctx)
}
