// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Minimal mintable ERC-721 used ONLY as a stand-in for the real
///         Agent ID registry in tests. Never deployed to mainnet.
contract MockAgentID is ERC721 {
    constructor() ERC721("Mock Agent ID", "MAID") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}
