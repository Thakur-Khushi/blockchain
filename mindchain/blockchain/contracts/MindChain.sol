// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title MindChain
/// @notice Patient-controlled consent and wellness-record integrity anchoring.
/// @dev Privacy rules:
///  - Only random record IDs and salted SHA-256 digests are stored. No names, emails,
///    diagnoses, journal text or other personal data ever reach the chain.
///  - The contract has no owner or admin. Only a patient can change their own consent
///    and records.
///  - A therapist address here proves nothing about professional identity; the
///    off-chain application verifies therapists before honouring a grant.
contract MindChain {
    struct Grant {
        bool active;
        uint64 grantedAt;
        uint64 expiresAt; // 0 = no expiry
    }

    struct Record {
        address owner;
        bytes32 digest;
        uint64 createdAt;
        uint64 updatedAt;
        uint32 version;
        bool revoked;
    }

    mapping(address => uint64) private _patientRegisteredAt;
    mapping(address => mapping(address => Grant)) private _grants;
    mapping(bytes32 => Record) private _records;

    event PatientRegistered(address indexed patient, uint64 timestamp);
    event AccessGranted(address indexed patient, address indexed therapist, uint64 expiresAt);
    event AccessRevoked(address indexed patient, address indexed therapist);
    event RecordRegistered(bytes32 indexed recordId, address indexed owner, bytes32 digest, uint32 version);
    event RecordUpdated(bytes32 indexed recordId, address indexed owner, bytes32 digest, uint32 version);
    event RecordRevoked(bytes32 indexed recordId, address indexed owner);

    error AlreadyRegistered();
    error NotRegisteredPatient();
    error InvalidTherapist();
    error InvalidExpiry();
    error NoActiveGrant();
    error InvalidRecordId();
    error InvalidDigest();
    error RecordAlreadyExists();
    error RecordNotFound();
    error NotRecordOwner();
    error RecordIsRevoked();
    error DigestUnchanged();

    modifier onlyRegisteredPatient() {
        if (_patientRegisteredAt[msg.sender] == 0) revert NotRegisteredPatient();
        _;
    }

    modifier onlyRecordOwner(bytes32 recordId) {
        Record storage r = _records[recordId];
        if (r.owner == address(0)) revert RecordNotFound();
        if (r.owner != msg.sender) revert NotRecordOwner();
        if (r.revoked) revert RecordIsRevoked();
        _;
    }

    // ---------------------------------------------------------------- patients

    function registerPatient() external {
        if (_patientRegisteredAt[msg.sender] != 0) revert AlreadyRegistered();
        uint64 nowTs = uint64(block.timestamp);
        _patientRegisteredAt[msg.sender] = nowTs;
        emit PatientRegistered(msg.sender, nowTs);
    }

    function isRegisteredPatient(address patient) external view returns (bool) {
        return _patientRegisteredAt[patient] != 0;
    }

    function patientRegisteredAt(address patient) external view returns (uint64) {
        return _patientRegisteredAt[patient];
    }

    // ----------------------------------------------------------------- consent

    /// @notice Grants (or re-grants with a new expiry) read access to a therapist.
    /// @param expiresAt Unix timestamp after which access lapses; 0 for no expiry.
    function grantAccess(address therapist, uint64 expiresAt) external onlyRegisteredPatient {
        if (therapist == address(0) || therapist == msg.sender) revert InvalidTherapist();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();
        _grants[msg.sender][therapist] = Grant({active: true, grantedAt: uint64(block.timestamp), expiresAt: expiresAt});
        emit AccessGranted(msg.sender, therapist, expiresAt);
    }

    function revokeAccess(address therapist) external onlyRegisteredPatient {
        Grant storage g = _grants[msg.sender][therapist];
        if (!g.active) revert NoActiveGrant();
        g.active = false;
        emit AccessRevoked(msg.sender, therapist);
    }

    /// @notice Authoritative consent check used by the backend before every disclosure.
    function hasAccess(address patient, address therapist) public view returns (bool) {
        Grant storage g = _grants[patient][therapist];
        return g.active && (g.expiresAt == 0 || block.timestamp < g.expiresAt);
    }

    function getGrant(address patient, address therapist)
        external
        view
        returns (bool active, uint64 grantedAt, uint64 expiresAt, bool currentlyValid)
    {
        Grant storage g = _grants[patient][therapist];
        return (g.active, g.grantedAt, g.expiresAt, hasAccess(patient, therapist));
    }

    // ----------------------------------------------------------------- records

    function registerRecord(bytes32 recordId, bytes32 digest) external onlyRegisteredPatient {
        if (recordId == bytes32(0)) revert InvalidRecordId();
        if (digest == bytes32(0)) revert InvalidDigest();
        if (_records[recordId].owner != address(0)) revert RecordAlreadyExists();
        uint64 nowTs = uint64(block.timestamp);
        _records[recordId] = Record({
            owner: msg.sender,
            digest: digest,
            createdAt: nowTs,
            updatedAt: nowTs,
            version: 1,
            revoked: false
        });
        emit RecordRegistered(recordId, msg.sender, digest, 1);
    }

    /// @notice Anchors the digest of an edited record. The previous digest stays
    ///         visible in the RecordRegistered / RecordUpdated event history.
    function updateRecord(bytes32 recordId, bytes32 newDigest) external onlyRecordOwner(recordId) {
        if (newDigest == bytes32(0)) revert InvalidDigest();
        Record storage r = _records[recordId];
        if (r.digest == newDigest) revert DigestUnchanged();
        r.digest = newDigest;
        r.updatedAt = uint64(block.timestamp);
        r.version += 1;
        emit RecordUpdated(recordId, msg.sender, newDigest, r.version);
    }

    /// @notice Marks a record as withdrawn (e.g. after the patient deletes it off-chain).
    function revokeRecord(bytes32 recordId) external onlyRecordOwner(recordId) {
        _records[recordId].revoked = true;
        _records[recordId].updatedAt = uint64(block.timestamp);
        emit RecordRevoked(recordId, msg.sender);
    }

    function getRecord(bytes32 recordId)
        external
        view
        returns (address owner, bytes32 digest, uint64 createdAt, uint64 updatedAt, uint32 version, bool revoked)
    {
        Record storage r = _records[recordId];
        if (r.owner == address(0)) revert RecordNotFound();
        return (r.owner, r.digest, r.createdAt, r.updatedAt, r.version, r.revoked);
    }

    function recordExists(bytes32 recordId) external view returns (bool) {
        return _records[recordId].owner != address(0);
    }

    /// @notice True only if the record exists, is not revoked and matches `digest`.
    function verifyRecord(bytes32 recordId, bytes32 digest) external view returns (bool) {
        Record storage r = _records[recordId];
        return r.owner != address(0) && !r.revoked && r.digest == digest;
    }
}
