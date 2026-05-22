package com.curseClimb.CurseClimb.controller;

import com.curseClimb.CurseClimb.model.GameState;
import com.curseClimb.CurseClimb.service.GameService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.stereotype.Controller;

@Controller
public class GameController {

    private final GameService gameService;

    @Autowired
    public GameController(GameService gameService) {
        this.gameService = gameService;
    }

    @MessageMapping("/create/{gameId}")
    @SendTo("/topic/gameState/{gameId}")
    public GameState createGame(@DestinationVariable String gameId, @Payload CreateGameRequest req) {
        return gameService.createGame(gameId, req.getNames());
    }

    @MessageMapping("/quit/{gameId}")
    @SendTo("/topic/gameState/{gameId}")
    public GameState quitGame(@DestinationVariable String gameId) {
        return gameService.quitGame(gameId);
    }

    @MessageMapping("/roll/{gameId}")
    @SendTo("/topic/gameState/{gameId}")
    public GameState rollDice(@DestinationVariable String gameId, @Payload String currentPlayerId) {
        return gameService.rollDice(gameId, currentPlayerId);
    }

    @MessageMapping("/task/{gameId}")
    @SendTo("/topic/gameState/{gameId}")
    public GameState submitTask(@DestinationVariable String gameId, @Payload TaskResult result) {
        return gameService.submitTask(gameId, result.getPlayerId(), result.isSuccess(), result.getWord());
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────
    public static class CreateGameRequest {
        private String[] names;
        public String[] getNames()           { return names; }
        public void setNames(String[] names) { this.names = names; }
    }

    public static class TaskResult {
        private String  playerId;
        private boolean success;
        private String  word;
        public String  getPlayerId()           { return playerId; }
        public void    setPlayerId(String p)   { this.playerId = p; }
        public boolean isSuccess()             { return success; }
        public void    setSuccess(boolean s)   { this.success = s; }
        public String  getWord()                { return word; }
        public void    setWord(String w)        { this.word = w; }
    }
}
