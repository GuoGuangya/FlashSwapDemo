// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract WETH is ERC20 {
    constructor() ERC20("WETH", "WETH") {}
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
