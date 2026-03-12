require("@nomicfoundation/hardhat-toolbox");
require("@nomiclabs/hardhat-vyper");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: "0.8.19",
    vyper: {
        version: "0.3.7",
    },
    networks: {
        hardhat: {
            chainId: 1337,
        },
    },
};
