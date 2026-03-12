require("@nomicfoundation/hardhat-toolbox");
require("@nomiclabs/hardhat-vyper");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    vyper: {
        version: "0.3.7",
    },
    networks: {
        hardhat: {
            chainId: 1337,
        },
    },
};
