
CREATE DATABASE datastore;
use datastore;
CREATE TABLE Posts (
  id int NOT NULL PRIMARY KEY AUTO_INCREMENT,
  datastore_uuid varchar(36) NOT NULL,
  title varchar(50) NOT NULL,
  
  _version int,
  _deleted Boolean,
  _lastChangedAt varchar(24) not null,
  createdAt varchar(24) not null,
  updatedAt varchar(24) not null
);

CREATE TABLE Comments (
  id int NOT NULL PRIMARY KEY AUTO_INCREMENT,
  datastore_uuid varchar(36) NOT NULL,
  postID int not null,
  content TEXT NOT NULL,
  
  _version int,
  _deleted Boolean,
  _lastChangedAt varchar(24) not null,
  createdAt varchar(24) not null,
  updatedAt varchar(24) not null,
  
  KEY `postID` (`postID`),
  CONSTRAINT `post_comments_ibfk_1` FOREIGN KEY (`postID`) REFERENCES `Posts` (`id`)
);