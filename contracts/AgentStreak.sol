// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Minimal interface of the Agent ID registry (ERC-721, non-transferable).
/// @dev Only balanceOf is needed: an address holds an Agent ID iff balanceOf > 0.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title Agent Streak
/// @notice Daily check-in streak tracker for Agent ID holders, with soulbound
///         milestone badges. One contract, no fees, no token sale, no treasury.
/// @dev Agent ID is the gate AND the identity: only addresses holding an
///      Agent ID can check in or claim badges. Streaks are tracked per UTC day
///      (day = block.timestamp / 86400). Badges are soulbound ERC-721s with
///      fully on-chain (base64 JSON + SVG) metadata.
contract AgentStreak is ERC721, Ownable, Pausable {
    using Strings for uint256;

    /// @notice The Agent ID registry contract (immutable, set at deploy time).
    IAgentID public immutable agentId;

    /// @notice Length of one streak day in seconds (UTC days).
    uint256 public constant DAY = 86400;

    /// @notice Streak milestones that unlock a soulbound badge.
    uint256[6] public milestones = [uint256(3), 7, 14, 30, 60, 90];

    struct UserInfo {
        uint256 currentStreak;
        uint256 maxStreak;
        uint256 totalCheckIns;
        uint256 lastCheckInDay;
    }

    mapping(address => UserInfo) private _users;
    mapping(address => mapping(uint256 => bool)) private _hasBadge;
    mapping(address => mapping(uint256 => uint256)) private _badgeTokenId;
    mapping(uint256 => uint256) private _badgeMilestone;
    address[] private _participants;
    mapping(address => bool) public isParticipant;
    uint256 private _nextTokenId = 1;

    event CheckIn(address indexed user, uint256 indexed day, uint256 streak, uint256 totalCheckIns);
    event BadgeClaimed(address indexed user, uint256 indexed milestone, uint256 indexed tokenId);

    constructor(address agentIdAddress) ERC721("Agent Streak Badge", "STREAK") Ownable(msg.sender) {
        require(agentIdAddress != address(0), "AgentStreak: zero Agent ID address");
        agentId = IAgentID(agentIdAddress);
    }

    /// @notice Check in for today. Requires holding an Agent ID, once per UTC day.
    function checkIn() external whenNotPaused {
        require(agentId.balanceOf(msg.sender) > 0, "AgentStreak: caller does not hold an Agent ID");
        uint256 day = block.timestamp / DAY;
        UserInfo storage u = _users[msg.sender];
        require(u.lastCheckInDay != day, "AgentStreak: already checked in today");

        if (!isParticipant[msg.sender]) {
            isParticipant[msg.sender] = true;
            _participants.push(msg.sender);
        }

        if (u.lastCheckInDay != 0 && u.lastCheckInDay == day - 1) {
            u.currentStreak += 1;
        } else {
            u.currentStreak = 1;
        }
        if (u.currentStreak > u.maxStreak) {
            u.maxStreak = u.currentStreak;
        }
        u.totalCheckIns += 1;
        u.lastCheckInDay = day;

        emit CheckIn(msg.sender, day, u.currentStreak, u.totalCheckIns);
    }

    /// @notice Claim the soulbound badge for a reached milestone (one per milestone per user).
    function claimBadge(uint256 milestone) external whenNotPaused {
        require(agentId.balanceOf(msg.sender) > 0, "AgentStreak: caller does not hold an Agent ID");
        require(_isMilestone(milestone), "AgentStreak: invalid milestone");
        require(!_hasBadge[msg.sender][milestone], "AgentStreak: badge already claimed");
        UserInfo storage u = _users[msg.sender];
        require(u.maxStreak >= milestone, "AgentStreak: milestone not reached");

        uint256 tokenId = _nextTokenId++;
        _hasBadge[msg.sender][milestone] = true;
        _badgeTokenId[msg.sender][milestone] = tokenId;
        _badgeMilestone[tokenId] = milestone;
        _safeMint(msg.sender, tokenId);

        emit BadgeClaimed(msg.sender, milestone, tokenId);
    }

    /// @notice Soulbound: badges can be minted but never transferred or burned.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        require(from == address(0), "AgentStreak: badge is soulbound");
        return super._update(to, tokenId, auth);
    }

    /// @notice Fully on-chain metadata: base64 JSON with an inline SVG image.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "AgentStreak: nonexistent token");
        uint256 milestone = _badgeMilestone[tokenId];
        string memory json = string(
            abi.encodePacked(
                '{"name":"Agent Streak Badge - ',
                milestone.toString(),
                '-Day Streak",',
                '"description":"Soulbound badge awarded to an Agent ID holder for a ',
                milestone.toString(),
                ' day daily check-in streak on Agent Streak. Check-ins cost gas only; no token, no rewards promised.",',
                '"attributes":[{"trait_type":"Milestone (days)","value":',
                milestone.toString(),
                '},{"trait_type":"Type","value":"Soulbound"}],',
                '"image":"',
                _badgeImage(milestone),
                '"}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    function _badgeImage(uint256 milestone) internal pure returns (string memory) {
        string memory svg = string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
                '<rect width="512" height="512" rx="48" fill="#0f172a"/>',
                '<circle cx="256" cy="196" r="98" fill="none" stroke="#f59e0b" stroke-width="10"/>',
                '<text x="256" y="230" font-family="sans-serif" font-size="92" font-weight="bold" fill="#fbbf24" text-anchor="middle">',
                milestone.toString(),
                '</text>',
                '<text x="256" y="326" font-family="sans-serif" font-size="34" fill="#e2e8f0" text-anchor="middle">DAY STREAK</text>',
                '<text x="256" y="388" font-family="sans-serif" font-size="26" fill="#94a3b8" text-anchor="middle">AGENT STREAK</text>',
                '</svg>'
            )
        );
        return string(abi.encodePacked("data:image/svg+xml;base64,", Base64.encode(bytes(svg))));
    }

    function _isMilestone(uint256 milestone) internal view returns (bool) {
        for (uint256 i = 0; i < milestones.length; i++) {
            if (milestones[i] == milestone) return true;
        }
        return false;
    }

    // ---- Views ----

    function getUserInfo(
        address user
    )
        external
        view
        returns (uint256 currentStreak, uint256 maxStreak, uint256 totalCheckIns, uint256 lastCheckInDay)
    {
        UserInfo storage u = _users[user];
        return (u.currentStreak, u.maxStreak, u.totalCheckIns, u.lastCheckInDay);
    }

    /// @notice True if the address holds an Agent ID and has not checked in today.
    function canCheckIn(address user) external view returns (bool) {
        if (agentId.balanceOf(user) == 0) return false;
        return _users[user].lastCheckInDay != block.timestamp / DAY;
    }

    function getParticipantsCount() external view returns (uint256) {
        return _participants.length;
    }

    /// @notice Paginated participant list. `limit` is capped at 200.
    function getParticipants(uint256 offset, uint256 limit) external view returns (address[] memory) {
        if (limit > 200) limit = 200;
        uint256 total = _participants.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        address[] memory out = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            out[i - offset] = _participants[i];
        }
        return out;
    }

    /// @notice Token id of the badge a user claimed for a milestone (0 if none).
    function badgeOf(address user, uint256 milestone) external view returns (uint256) {
        return _badgeTokenId[user][milestone];
    }

    function hasBadge(address user, uint256 milestone) external view returns (bool) {
        return _hasBadge[user][milestone];
    }

    // ---- Admin (owner only; emergency pause only) ----

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
